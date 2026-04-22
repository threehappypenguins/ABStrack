import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Ionicons } from '@expo/vector-icons';
import DateTimePicker from '@react-native-community/datetimepicker';
import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import {
  Alert,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import {
  CommonActions,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  EpisodeRow,
  EpisodeType,
  FoodDiaryEntryRow,
  HealthMarkerRow,
  MealTag,
  PresetHealthMarkerRow,
} from '@abstrack/types';
import {
  bacReadingSuggestsAbsEpisode,
  formatEpisodeDurationSimple,
  MEAL_TAGS,
  PRESET_HEALTH_MARKER_KIND_LABELS,
  validatePresetHealthMarkerCustomFields,
} from '@abstrack/types';
import {
  cancelActiveEpisodeById,
  completeEpisodePostMarkerStep,
  createFoodDiaryEntry,
  deleteFoodDiaryEntry,
  endEpisodeIfStillActive,
  getEpisodeById,
  listFoodDiaryEntriesForEpisode,
  listEpisodeHealthMarkersForEpisode,
  listPresetHealthMarkersForPreset,
  updateFoodDiaryEntry,
  upsertEpisodeHealthMarkerForLine,
} from '@abstrack/supabase';
import { announce, COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { clearSymptomPromptSession } from '../../lib/episodes/symptom-prompt-session-store';
import {
  currentLocalDate,
  currentLocalTime,
  isoToLocalDate,
  isoToLocalTime,
  localDateFromDate,
  localDateTimeToIso,
  localTimeFromDate,
} from '../../lib/food-diary/date-time';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type HealthMarkerPromptRoute = RouteProp<
  MainStackParamList,
  'HealthMarkerPrompt'
>;
type HealthMarkerPromptNav = NativeStackNavigationProp<
  MainStackParamList,
  'HealthMarkerPrompt'
>;

type MarkerDraft = {
  value: string;
  systolic: string;
  diastolic: string;
  notes: string;
};

type PersistFeedback =
  | { source: 'validation'; message: string }
  | { source: 'sync'; message: string };

function normalizeNullable(value: string | null | undefined): string | null {
  const next = value?.trim() ?? '';
  return next.length > 0 ? next : null;
}

function trimToNull(value: string): string | null {
  const t = value.trim();
  return t.length > 0 ? t : null;
}

function markerLineTitle(line: PresetHealthMarkerRow): string {
  if (line.marker_kind !== 'custom') {
    return PRESET_HEALTH_MARKER_KIND_LABELS[line.marker_kind];
  }
  const customName = normalizeNullable(line.custom_name);
  return customName ?? PRESET_HEALTH_MARKER_KIND_LABELS.custom;
}

function createDraftFromMarker(row: HealthMarkerRow | null): MarkerDraft {
  return {
    value: row?.value_numeric != null ? String(row.value_numeric) : '',
    systolic: row?.systolic_numeric != null ? String(row.systolic_numeric) : '',
    diastolic:
      row?.diastolic_numeric != null ? String(row.diastolic_numeric) : '',
    notes: row?.notes ?? '',
  };
}

function findExistingMarkerForLine(
  rows: HealthMarkerRow[],
  line: PresetHealthMarkerRow,
): HealthMarkerRow | null {
  return rows.find((row) => row.preset_health_marker_id === line.id) ?? null;
}

type MeasurementDraftResult =
  | {
      ok: true;
      valueNumeric: number | null;
      systolicNumeric: number | null;
      diastolicNumeric: number | null;
    }
  | { ok: false; message: string };

/**
 * Parses numeric fields the same way as {@link saveCurrentLine}. Skip is allowed when this fails
 * (incomplete or invalid measurement) so users are never stuck between a disabled Skip and Next.
 */
function parseMeasurementDraftForSave(
  line: PresetHealthMarkerRow,
  draft: MarkerDraft,
): MeasurementDraftResult {
  const value = parseOptionalNumber(draft.value);
  const systolic = parseOptionalNumber(draft.systolic);
  const diastolic = parseOptionalNumber(draft.diastolic);

  if (line.marker_kind === 'blood_pressure') {
    if (systolic == null || diastolic == null) {
      return {
        ok: false,
        message:
          'Enter both systolic and diastolic blood pressure values to continue.',
      };
    }
    if (Number.isNaN(systolic) || Number.isNaN(diastolic)) {
      return {
        ok: false,
        message:
          'Blood pressure values must be valid numbers (for example 120 and 80).',
      };
    }
    return {
      ok: true,
      valueNumeric: null,
      systolicNumeric: systolic,
      diastolicNumeric: diastolic,
    };
  }
  if (value == null) {
    return { ok: false, message: 'Enter a numeric value to continue.' };
  }
  if (Number.isNaN(value)) {
    return { ok: false, message: 'Value must be a valid number.' };
  }
  return {
    ok: true,
    valueNumeric: value,
    systolicNumeric: null,
    diastolicNumeric: null,
  };
}

function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

/**
 * Linear in-episode health marker stepper that follows the symptom phase.
 *
 * @returns One marker at a time with manual numeric entry and persistence.
 */
export function HealthMarkerPromptScreen() {
  const navigation = useNavigation<HealthMarkerPromptNav>();
  const route = useRoute<HealthMarkerPromptRoute>();
  const { episodeId, resume = false } = route.params;
  const { colors } = useAppTheme();

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistFeedback, setPersistFeedback] =
    useState<PersistFeedback | null>(null);
  const [phase, setPhase] = useState<
    'prompting' | 'postMarkers' | 'foodDiary' | 'complete'
  >('prompting');
  const [userId, setUserId] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MarkerDraft>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [bacSuggestAbs, setBacSuggestAbs] = useState(false);
  const [episodeRow, setEpisodeRow] = useState<EpisodeRow | null>(null);
  const [postEpisodeKind, setPostEpisodeKind] = useState<EpisodeType>('Other');
  const [postLabel, setPostLabel] = useState('');
  const [postAdditional, setPostAdditional] = useState('');
  const [postNote, setPostNote] = useState('');
  const [savingPost, setSavingPost] = useState(false);
  const [postFeedback, setPostFeedback] = useState<string | null>(null);
  const [mealTag, setMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const initialFoodDateTimeRef = useRef({
    date: currentLocalDate(),
    time: currentLocalTime(),
  });
  const [foodLoggedDate, setFoodLoggedDate] = useState(
    initialFoodDateTimeRef.current.date,
  );
  const [foodLoggedTime, setFoodLoggedTime] = useState(
    initialFoodDateTimeRef.current.time,
  );
  const [addFoodInitialDate, setAddFoodInitialDate] = useState(
    initialFoodDateTimeRef.current.date,
  );
  const [addFoodInitialTime, setAddFoodInitialTime] = useState(
    initialFoodDateTimeRef.current.time,
  );
  const [foodEntries, setFoodEntries] = useState<FoodDiaryEntryRow[]>([]);
  const [foodEntriesLoading, setFoodEntriesLoading] = useState(false);
  const [foodEntriesError, setFoodEntriesError] = useState<string | null>(null);
  const [savingFoodDiary, setSavingFoodDiary] = useState(false);
  const [foodDiaryFeedback, setFoodDiaryFeedback] = useState<string | null>(
    null,
  );
  const [editingFoodEntryId, setEditingFoodEntryId] = useState<string | null>(
    null,
  );
  const [deletingFoodEntryId, setDeletingFoodEntryId] = useState<string | null>(
    null,
  );
  const [isAddFoodEntryOpen, setIsAddFoodEntryOpen] = useState(true);
  const [isAddFoodEntryDirty, setIsAddFoodEntryDirty] = useState(false);
  const [foodDatePickerOpen, setFoodDatePickerOpen] = useState(false);
  const [foodTimePickerOpen, setFoodTimePickerOpen] = useState(false);
  const [foodDiaryDecision, setFoodDiaryDecision] = useState<
    'pending' | 'saved' | 'skipped'
  >('pending');
  const [endingEpisode, setEndingEpisode] = useState(false);
  const [endFeedback, setEndFeedback] = useState<string | null>(null);
  const [endedSummary, setEndedSummary] = useState<{
    endedAt: string;
    durationText: string | null;
  } | null>(null);
  const postFormInitRef = useRef(false);
  const [cancelingEpisode, setCancelingEpisode] = useState(false);

  useEffect(() => {
    setPersistFeedback(null);
  }, [activeIndex]);

  useEffect(() => {
    if (phase !== 'postMarkers' || !episodeRow || postFormInitRef.current) {
      return;
    }
    postFormInitRef.current = true;
    const suggestInitialAbs =
      episodeRow.episode_type === 'ABS' ||
      (episodeRow.episode_type === 'Other' && bacSuggestAbs);
    setPostEpisodeKind(suggestInitialAbs ? 'ABS' : 'Other');
    setPostLabel(episodeRow.episode_label ?? '');
    setPostAdditional(episodeRow.additional_notes ?? '');
    setPostNote(episodeRow.note ?? '');
  }, [phase, episodeRow, bacSuggestAbs]);

  const supabase = useMemo(() => getMobileSupabaseClient(), []);
  /** Bumps when the screen unmounts or `load` deps change so stale async work does not setState. */
  const loadGenerationRef = useRef(0);

  const load = useCallback(async () => {
    const generation = ++loadGenerationRef.current;
    const stale = () => generation !== loadGenerationRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistFeedback(null);
    setPhase('prompting');
    postFormInitRef.current = false;
    setPostFeedback(null);
    const initialFoodDate = currentLocalDate();
    const initialFoodTime = currentLocalTime();
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(initialFoodDate);
    setFoodLoggedTime(initialFoodTime);
    setAddFoodInitialDate(initialFoodDate);
    setAddFoodInitialTime(initialFoodTime);
    setFoodEntries([]);
    setFoodEntriesLoading(false);
    setFoodEntriesError(null);
    setSavingFoodDiary(false);
    setFoodDiaryFeedback(null);
    setEditingFoodEntryId(null);
    setIsAddFoodEntryOpen(true);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setFoodDiaryDecision('pending');
    setEndFeedback(null);
    setEndedSummary(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (stale()) {
      return;
    }
    if (!user) {
      setErrorMessage(
        'You must be signed in to save health marker answers. Try signing in again.',
      );
      setStatus('error');
      return;
    }
    setUserId(user.id);

    const episode = await getEpisodeById(supabase, episodeId);
    if (stale()) {
      return;
    }
    if (!episode.ok) {
      setErrorMessage(episode.error.message);
      setStatus('error');
      return;
    }
    const markerPresetId = episode.data?.health_marker_preset_id;
    if (!markerPresetId) {
      setErrorMessage(
        'This episode has no health marker preset linked. Return home and start a new episode template.',
      );
      setStatus('error');
      return;
    }
    setEpisodeRow(episode.data);
    if (episode.data?.ended_at) {
      setEndedSummary({
        endedAt: episode.data.ended_at,
        durationText: formatEpisodeDurationSimple(
          episode.data.started_at,
          episode.data.ended_at,
        ),
      });
    }

    const [presetLines, markerRows] = await Promise.all([
      listPresetHealthMarkersForPreset(supabase, markerPresetId),
      listEpisodeHealthMarkersForEpisode(supabase, episodeId),
    ]);
    if (stale()) {
      return;
    }
    if (!presetLines.ok) {
      setErrorMessage(presetLines.error.message);
      setStatus('error');
      return;
    }
    if (!markerRows.ok) {
      setErrorMessage(markerRows.error.message);
      setStatus('error');
      return;
    }

    setLines(presetLines.data);

    const nextDrafts: Record<string, MarkerDraft> = {};
    for (const line of presetLines.data) {
      const marker = findExistingMarkerForLine(markerRows.data, line);
      nextDrafts[line.id] = createDraftFromMarker(marker);
    }
    setDrafts(nextDrafts);

    // Initial hydrate / resume; values logged later in this session are picked up in
    // enterFoodDiaryPhaseAfterMarkers before the post-marker step.
    setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));

    const firstUnanswered = presetLines.data.findIndex((line) => {
      const row = findExistingMarkerForLine(markerRows.data, line);
      return row === null;
    });
    if (resume && firstUnanswered === -1) {
      if (episode.data?.post_marker_step_completed_at) {
        setPhase('complete');
      } else {
        setPhase('foodDiary');
      }
    } else if (resume && firstUnanswered >= 0) {
      setActiveIndex(firstUnanswered);
    } else {
      setActiveIndex(0);
    }
    setStatus('ready');
  }, [episodeId, resume, supabase]);

  useEffect(() => {
    void load();
    return () => {
      loadGenerationRef.current += 1;
    };
  }, [load]);

  const currentLine = lines[activeIndex] ?? null;
  const currentDraft = currentLine
    ? (drafts[currentLine.id] ?? createDraftFromMarker(null))
    : createDraftFromMarker(null);
  // Skip stays available until the draft passes the same checks as Next/save (both BP fields
  // valid, or a valid scalar). Partial BP entry must not disable Skip.
  const measurementReadyForSave = currentLine
    ? parseMeasurementDraftForSave(currentLine, currentDraft).ok
    : false;
  const canSkip = Boolean(currentLine) && !measurementReadyForSave;
  const skipPressable = canSkip && !saving;
  const continueToFoodDiary =
    lines.length === 0 || activeIndex >= lines.length - 1;
  const foodDiaryContinueDisabled =
    savingFoodDiary ||
    deletingFoodEntryId != null ||
    foodEntriesLoading ||
    foodEntriesError != null;

  const onUpdateDraft = (patch: Partial<MarkerDraft>) => {
    if (!currentLine) {
      return;
    }
    setDrafts((prev) => ({
      ...prev,
      [currentLine.id]: {
        ...(prev[currentLine.id] ?? createDraftFromMarker(null)),
        ...patch,
      },
    }));
  };

  const goBackStep = () => {
    if (activeIndex <= 0 || saving) {
      return;
    }
    setActiveIndex((prev) => prev - 1);
  };

  const saveCurrentLine = async (): Promise<boolean> => {
    if (!currentLine || !userId) {
      return false;
    }
    const customValidation = validatePresetHealthMarkerCustomFields(
      currentLine.marker_kind,
      currentLine.custom_name ?? '',
      currentLine.custom_unit ?? '',
    );
    if (customValidation) {
      setPersistFeedback({ source: 'validation', message: customValidation });
      await announce(customValidation, { politeness: 'assertive' });
      return false;
    }

    const parsed = parseMeasurementDraftForSave(currentLine, currentDraft);
    if (!parsed.ok) {
      setPersistFeedback({
        source: 'validation',
        message: parsed.message,
      });
      await announce(parsed.message, { politeness: 'assertive' });
      return false;
    }

    setSaving(true);
    setPersistFeedback(null);
    const result = await upsertEpisodeHealthMarkerForLine(supabase, {
      userId,
      episodeId,
      line: currentLine,
      valueNumeric: parsed.valueNumeric,
      systolicNumeric: parsed.systolicNumeric,
      diastolicNumeric: parsed.diastolicNumeric,
      notes: currentDraft.notes.trim() ? currentDraft.notes.trim() : null,
    });
    setSaving(false);
    if (!result.ok) {
      setPersistFeedback({ source: 'sync', message: result.error.message });
      await announce(
        `Could not sync with the server: ${result.error.message}`,
        {
          politeness: 'assertive',
        },
      );
      return false;
    }
    return true;
  };

  /**
   * Re-reads saved episode markers so BAC suggestion reflects values logged during this session,
   * then moves to the food diary step.
   */
  const enterFoodDiaryPhaseAfterMarkers = useCallback(async () => {
    const markerRows = await listEpisodeHealthMarkersForEpisode(
      supabase,
      episodeId,
    );
    if (markerRows.ok) {
      setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));
    }
    setPhase('foodDiary');
  }, [episodeId, supabase]);

  const goNext = async () => {
    if (saving) {
      return;
    }
    if (!currentLine) {
      await enterFoodDiaryPhaseAfterMarkers();
      await announce(
        lines.length === 0
          ? 'No preset health markers to log. Continue to food diary.'
          : 'Health marker list complete.',
        { politeness: 'polite' },
      );
      return;
    }
    const saved = await saveCurrentLine();
    if (!saved) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      await enterFoodDiaryPhaseAfterMarkers();
      await announce('Health marker list complete.', { politeness: 'polite' });
      return;
    }
    setActiveIndex((prev) => prev + 1);
  };

  const skipCurrent = async () => {
    if (!currentLine || saving) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      await enterFoodDiaryPhaseAfterMarkers();
      await announce('Health marker list complete.', { politeness: 'polite' });
      return;
    }
    setActiveIndex((prev) => prev + 1);
  };

  const onSubmitPostMarkers = async () => {
    if (savingPost) {
      return;
    }
    setSavingPost(true);
    setPostFeedback(null);
    const completedAt = new Date().toISOString();
    const result = await completeEpisodePostMarkerStep(supabase, episodeId, {
      episode_type: postEpisodeKind,
      episode_label: trimToNull(postLabel),
      additional_notes: trimToNull(postAdditional),
      note: trimToNull(postNote),
      post_marker_step_completed_at: completedAt,
    });
    setSavingPost(false);
    if (!result.ok) {
      setPostFeedback(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    setEpisodeRow(result.data);
    setEndFeedback(null);
    setEndedSummary(null);
    setPhase('complete');
    await announce('Episode details saved.', { politeness: 'polite' });
  };

  const onSaveFoodDiary = async () => {
    if (savingFoodDiary || !userId) {
      return;
    }
    setSavingFoodDiary(true);
    setFoodDiaryFeedback(null);
    if (!mealTag) {
      const message = 'Choose a meal tag.';
      setFoodDiaryFeedback(message);
      await announce(message, { politeness: 'assertive' });
      setSavingFoodDiary(false);
      return;
    }
    const loggedAtIso = localDateTimeToIso(foodLoggedDate, foodLoggedTime);
    if (!loggedAtIso) {
      const message = 'Enter a valid date and time.';
      setFoodDiaryFeedback(message);
      await announce(message, { politeness: 'assertive' });
      setSavingFoodDiary(false);
      return;
    }
    const result =
      editingFoodEntryId == null
        ? await createFoodDiaryEntry(supabase, {
            user_id: userId,
            episode_id: episodeId,
            meal_tag: mealTag,
            food_note: foodNote,
            logged_at: loggedAtIso,
          })
        : await updateFoodDiaryEntry(supabase, editingFoodEntryId, {
            meal_tag: mealTag,
            food_note: foodNote,
            logged_at: loggedAtIso,
          });
    setSavingFoodDiary(false);
    if (!result.ok) {
      setFoodDiaryFeedback(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    const foodEntriesResult = await listFoodDiaryEntriesForEpisode(
      supabase,
      episodeId,
    );
    if (foodEntriesResult.ok) {
      setFoodEntries(foodEntriesResult.data);
      setFoodEntriesError(null);
    } else {
      setFoodEntriesError(foodEntriesResult.error.message);
    }
    const initialFoodDate = currentLocalDate();
    const initialFoodTime = currentLocalTime();
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(initialFoodDate);
    setFoodLoggedTime(initialFoodTime);
    setAddFoodInitialDate(initialFoodDate);
    setAddFoodInitialTime(initialFoodTime);
    setEditingFoodEntryId(null);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    if (editingFoodEntryId == null) {
      setIsAddFoodEntryOpen(false);
    }
    setFoodDiaryFeedback(null);
    await announce(
      editingFoodEntryId == null ? 'Food entry saved.' : 'Food entry updated.',
      { politeness: 'polite' },
    );
  };

  const onContinueFromFoodDiary = async () => {
    if (foodDiaryContinueDisabled) {
      return;
    }
    setFoodDiaryDecision(foodEntries.length > 0 ? 'saved' : 'skipped');
    setFoodDiaryFeedback(null);
    setPhase('postMarkers');
    await announce('Continue to episode details.', {
      politeness: 'polite',
    });
  };

  const onBackToHealthMarkersFromFoodDiary = async () => {
    setFoodDiaryFeedback(null);
    setPhase('prompting');
    await announce('Returned to health markers.', { politeness: 'polite' });
  };

  const onBackToSymptomsFromHealthMarkers = useCallback(async () => {
    const symptomPresetId = episodeRow?.symptom_preset_id;
    if (!symptomPresetId) {
      await announce(
        'This episode has no symptom preset linked, so symptoms cannot be reopened.',
        { politeness: 'assertive' },
      );
      return;
    }
    navigation.replace('SymptomPrompt', {
      episodeId,
      symptomPresetId,
      resume: true,
    });
  }, [episodeId, episodeRow, navigation]);

  const onBackToFoodDiaryFromPostMarkers = async () => {
    setPostFeedback(null);
    setPhase('foodDiary');
    await announce('Returned to food diary.', { politeness: 'polite' });
  };

  const onEditFoodEntry = (entry: FoodDiaryEntryRow) => {
    setEditingFoodEntryId(entry.id);
    setIsAddFoodEntryOpen(false);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setMealTag(entry.meal_tag);
    setFoodNote(entry.food_note);
    setFoodLoggedDate(isoToLocalDate(entry.logged_at));
    setFoodLoggedTime(isoToLocalTime(entry.logged_at));
    setFoodDiaryFeedback(null);
  };

  const onNewFoodEntry = () => {
    setEditingFoodEntryId(null);
    const initialFoodDate = currentLocalDate();
    const initialFoodTime = currentLocalTime();
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(initialFoodDate);
    setFoodLoggedTime(initialFoodTime);
    setAddFoodInitialDate(initialFoodDate);
    setAddFoodInitialTime(initialFoodTime);
    setFoodDiaryFeedback(null);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setIsAddFoodEntryOpen(true);
  };

  const onDiscardFoodEditChanges = () => {
    setEditingFoodEntryId(null);
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(currentLocalDate());
    setFoodLoggedTime(currentLocalTime());
    setFoodDiaryFeedback(null);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setIsAddFoodEntryOpen(false);
  };

  const computeIsAddFoodEntryDirty = useCallback(
    (next: {
      mealTag: MealTag | null;
      foodNote: string;
      foodLoggedDate: string;
      foodLoggedTime: string;
    }) => {
      return (
        next.mealTag != null ||
        next.foodNote.trim().length > 0 ||
        next.foodLoggedDate !== addFoodInitialDate ||
        next.foodLoggedTime !== addFoodInitialTime
      );
    },
    [addFoodInitialDate, addFoodInitialTime],
  );

  const onDiscardAddFoodDraft = useCallback(() => {
    if (!isAddFoodEntryDirty) {
      setIsAddFoodEntryOpen(false);
      return;
    }
    Alert.alert(
      'Discard this food entry draft?',
      'Your unsaved entry will be removed.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard entry',
          style: 'destructive',
          onPress: () => {
            const initialFoodDate = currentLocalDate();
            const initialFoodTime = currentLocalTime();
            setMealTag(null);
            setFoodNote('');
            setFoodLoggedDate(initialFoodDate);
            setFoodLoggedTime(initialFoodTime);
            setAddFoodInitialDate(initialFoodDate);
            setAddFoodInitialTime(initialFoodTime);
            setIsAddFoodEntryDirty(false);
            setFoodDiaryFeedback(null);
            setFoodDatePickerOpen(false);
            setFoodTimePickerOpen(false);
            setIsAddFoodEntryOpen(false);
          },
        },
      ],
    );
  }, [isAddFoodEntryDirty]);

  const foodLoggedDateTimeValue = useMemo(() => {
    const iso = localDateTimeToIso(foodLoggedDate, foodLoggedTime);
    return iso ? new Date(iso) : new Date();
  }, [foodLoggedDate, foodLoggedTime]);

  const foodLoggedDateLabel = useMemo(() => {
    return foodLoggedDateTimeValue.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [foodLoggedDateTimeValue]);

  const foodLoggedTimeLabel = useMemo(() => {
    return foodLoggedDateTimeValue.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [foodLoggedDateTimeValue]);

  const onFoodDatePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setFoodDatePickerOpen(false);
      }
      if (event.type === 'dismissed') {
        return;
      }
      if (!selectedDate) {
        return;
      }
      const nextDate = localDateFromDate(selectedDate);
      setFoodLoggedDate(nextDate);
      if (editingFoodEntryId == null) {
        setIsAddFoodEntryDirty(
          computeIsAddFoodEntryDirty({
            mealTag,
            foodNote,
            foodLoggedDate: nextDate,
            foodLoggedTime,
          }),
        );
      }
    },
    [
      computeIsAddFoodEntryDirty,
      editingFoodEntryId,
      foodLoggedTime,
      foodNote,
      mealTag,
    ],
  );

  const onFoodTimePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setFoodTimePickerOpen(false);
      }
      if (event.type === 'dismissed') {
        return;
      }
      if (!selectedDate) {
        return;
      }
      const nextTime = localTimeFromDate(selectedDate);
      setFoodLoggedTime(nextTime);
      if (editingFoodEntryId == null) {
        setIsAddFoodEntryDirty(
          computeIsAddFoodEntryDirty({
            mealTag,
            foodNote,
            foodLoggedDate,
            foodLoggedTime: nextTime,
          }),
        );
      }
    },
    [
      computeIsAddFoodEntryDirty,
      editingFoodEntryId,
      foodLoggedDate,
      foodNote,
      mealTag,
    ],
  );

  const loadFoodEntries = useCallback(async () => {
    setFoodEntriesLoading(true);
    setFoodEntriesError(null);
    const result = await listFoodDiaryEntriesForEpisode(supabase, episodeId);
    setFoodEntriesLoading(false);
    if (!result.ok) {
      setFoodEntriesError(result.error.message);
      return;
    }
    setFoodEntries(result.data);
  }, [episodeId, supabase]);

  const onDeleteFoodEntry = useCallback(
    (entryId: string) => {
      if (savingFoodDiary || deletingFoodEntryId) {
        return;
      }
      Alert.alert('Discard this saved food entry?', 'This cannot be undone.', [
        { text: 'Keep entry', style: 'cancel' },
        {
          text: 'Discard entry',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingFoodEntryId(entryId);
              setFoodDiaryFeedback(null);
              const result = await deleteFoodDiaryEntry(supabase, entryId);
              setDeletingFoodEntryId(null);
              if (!result.ok) {
                setFoodDiaryFeedback(result.error.message);
                await announce(result.error.message, {
                  politeness: 'assertive',
                });
                return;
              }
              if (editingFoodEntryId === entryId) {
                onNewFoodEntry();
                setIsAddFoodEntryOpen(false);
              }
              await loadFoodEntries();
              await announce('Food entry discarded.', { politeness: 'polite' });
            })();
          },
        },
      ]);
    },
    [
      deletingFoodEntryId,
      editingFoodEntryId,
      loadFoodEntries,
      onNewFoodEntry,
      savingFoodDiary,
      supabase,
    ],
  );

  useEffect(() => {
    if (phase !== 'foodDiary') {
      return;
    }
    void loadFoodEntries();
  }, [phase, loadFoodEntries]);

  const onCancelEpisodePress = () => {
    if (cancelingEpisode) {
      return;
    }
    Alert.alert(
      'Cancel this active episode?',
      'Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
      [
        { text: 'Keep episode', style: 'cancel' },
        {
          text: 'Cancel episode',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setCancelingEpisode(true);
              try {
                const result = await cancelActiveEpisodeById(
                  supabase,
                  episodeId,
                );
                if (!result.ok) {
                  await announce(result.error.message, {
                    politeness: 'assertive',
                  });
                  return;
                }
                clearSymptomPromptSession(episodeId);
                if (result.data.didCancel) {
                  await announce(
                    'Episode canceled. Resume is no longer available.',
                    {
                      politeness: 'polite',
                    },
                  );
                } else {
                  await announce('This episode is no longer active.', {
                    politeness: 'polite',
                  });
                }
                navigation.dispatch(
                  CommonActions.reset({
                    index: 0,
                    routes: [{ name: 'MainTabs' }],
                  }),
                );
              } finally {
                setCancelingEpisode(false);
              }
            })();
          },
        },
      ],
    );
  };

  const onFinishToHome = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
    );
  };

  const onEndEpisode = useCallback(async () => {
    if (endingEpisode) {
      return;
    }
    if (!episodeRow) {
      const message = 'Could not find this episode. Please try again.';
      setEndFeedback(message);
      await announce(message, { politeness: 'assertive' });
      return;
    }
    setEndingEpisode(true);
    setEndFeedback(null);
    try {
      const nowIso = new Date().toISOString();
      const startedAtMs = Date.parse(episodeRow.started_at);
      const nowMs = Date.parse(nowIso);
      const endedAt =
        Number.isFinite(startedAtMs) &&
        Number.isFinite(nowMs) &&
        nowMs < startedAtMs
          ? episodeRow.started_at
          : nowIso;
      const result = await endEpisodeIfStillActive(
        supabase,
        episodeId,
        endedAt,
        episodeRow.started_at,
      );
      if (!result.ok) {
        setEndFeedback(result.error.message);
        await announce(result.error.message, { politeness: 'assertive' });
        return;
      }
      clearSymptomPromptSession(episodeId);
      if (result.data.didEnd) {
        const durationText = formatEpisodeDurationSimple(
          episodeRow.started_at,
          endedAt,
        );
        setEpisodeRow((prev) => (prev ? { ...prev, ended_at: endedAt } : prev));
        setEndedSummary({ endedAt, durationText });
        await announce(
          durationText
            ? `Episode ended. Duration ${durationText}.`
            : 'Episode ended.',
          { politeness: 'polite' },
        );
        return;
      }
      const latest = await getEpisodeById(supabase, episodeId);
      if (latest.ok && latest.data?.ended_at) {
        const durationText = formatEpisodeDurationSimple(
          latest.data.started_at,
          latest.data.ended_at,
        );
        setEpisodeRow(latest.data);
        setEndedSummary({ endedAt: latest.data.ended_at, durationText });
        await announce('This episode was already ended.', {
          politeness: 'polite',
        });
        return;
      }
      const message =
        'This episode is no longer active. Return home and refresh episodes.';
      setEndFeedback(message);
      await announce(message, { politeness: 'assertive' });
    } finally {
      setEndingEpisode(false);
    }
  }, [endingEpisode, episodeId, episodeRow, supabase]);

  const onRequestEndEpisode = useCallback(() => {
    if (endingEpisode || endedSummary) {
      return;
    }
    Alert.alert(
      'End this episode now?',
      'Ending sets this episode as complete and removes resume progress from this device. You can still view it in history.',
      [
        { text: 'Not yet', style: 'cancel' },
        {
          text: 'End episode',
          style: 'destructive',
          onPress: () => {
            void onEndEpisode();
          },
        },
      ],
    );
  }, [endedSummary, endingEpisode, onEndEpisode]);

  return (
    <ScreenShell contentAlign="stretch">
      <View className="min-h-0 flex-1 gap-4">
        <Text
          accessibilityRole="header"
          className={`text-[22px] font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          {phase === 'postMarkers'
            ? 'Episode details'
            : phase === 'foodDiary'
              ? 'Food diary'
              : 'Episode health markers'}
        </Text>
        {phase === 'prompting' && persistFeedback ? (
          <Text
            accessibilityLiveRegion="polite"
            className="text-sm text-amber-800 dark:text-amber-200"
            maxFontSizeMultiplier={2}
          >
            {persistFeedback.source === 'sync'
              ? `Could not sync with the server: ${persistFeedback.message}`
              : persistFeedback.message}
          </Text>
        ) : null}

        {phase === 'complete' ? (
          <View className="gap-4" accessibilityLiveRegion="polite">
            {endedSummary ? (
              <>
                <Text
                  className={`text-base leading-relaxed ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  This episode is ended and saved.
                </Text>
                <Text
                  className={`text-sm ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Ended {new Date(endedSummary.endedAt).toLocaleString()}
                </Text>
                <Text
                  className={`text-sm ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Duration {endedSummary.durationText ?? '—'}
                </Text>
              </>
            ) : (
              <Text
                className={`text-base leading-relaxed ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                {foodDiaryDecision === 'saved'
                  ? 'Preset prompts, episode details, and food diary are saved. End this episode to prevent stale resume state.'
                  : 'Preset prompts and episode details are saved. End this episode to prevent stale resume state.'}
              </Text>
            )}
            {endFeedback ? (
              <Text
                className={`text-sm ${nw.textError}`}
                accessibilityLiveRegion="assertive"
                maxFontSizeMultiplier={2}
              >
                {endFeedback}
              </Text>
            ) : null}
            {endedSummary ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Return to home"
                onPress={onFinishToHome}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 dark:bg-red-600"
              >
                <Text className="text-center text-[17px] font-semibold text-white">
                  Return home
                </Text>
              </Pressable>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  endingEpisode ? 'Ending episode' : 'End episode'
                }
                accessibilityState={{ disabled: endingEpisode }}
                disabled={endingEpisode}
                onPress={onRequestEndEpisode}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 disabled:opacity-60 dark:bg-red-600"
              >
                <Text className="text-center text-[17px] font-semibold text-white">
                  {endingEpisode ? 'Ending episode…' : 'End episode'}
                </Text>
              </Pressable>
            )}
          </View>
        ) : phase === 'foodDiary' ? (
          <>
            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <Text
                className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                Add one or more meals/snacks for this episode, or skip this
                step.
              </Text>
              <Text
                accessibilityRole="header"
                className={`mb-2 text-lg font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Saved entries
              </Text>
              {foodEntriesLoading ? (
                <Text
                  className={`mb-2 text-sm ${nw.textMuted}`}
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={2}
                >
                  Loading entries…
                </Text>
              ) : null}
              {foodEntriesError ? (
                <View className="mb-3">
                  <Text
                    className={`mb-2 text-sm ${nw.textError}`}
                    accessibilityLiveRegion="assertive"
                    maxFontSizeMultiplier={2}
                  >
                    {foodEntriesError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Try again to load food diary entries"
                    accessibilityState={{ disabled: foodEntriesLoading }}
                    disabled={foodEntriesLoading}
                    onPress={() => {
                      void loadFoodEntries();
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 disabled:opacity-50 dark:border-app-border-dark"
                  >
                    <Text
                      className={`text-base font-medium ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {foodEntriesLoading ? 'Retrying…' : 'Try again'}
                    </Text>
                  </Pressable>
                </View>
              ) : null}
              {!foodEntriesLoading &&
              !foodEntriesError &&
              foodEntries.length === 0 ? (
                <Text
                  className={`mb-3 text-sm ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  No food entries yet for this episode.
                </Text>
              ) : null}
              {foodEntries.map((entry) => (
                <View
                  key={entry.id}
                  className="mb-3 rounded-xl border border-app-border bg-app-bg p-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-base font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {entry.meal_tag}
                  </Text>
                  <Text
                    className={`mt-1 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    {new Date(entry.logged_at).toLocaleString()}
                  </Text>
                  <Text
                    className={`mt-2 text-sm ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {entry.food_note}
                  </Text>
                  {editingFoodEntryId !== entry.id ? (
                    <View className="mt-2 flex-row items-center justify-end gap-2">
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Edit ${entry.meal_tag} food entry`}
                        onPress={() => {
                          onEditFoodEntry(entry);
                        }}
                        style={{
                          minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                          minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                        }}
                        className="items-center justify-center rounded-lg border border-app-border px-2 active:opacity-80 dark:border-app-border-dark"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Ionicons
                          name="pencil-outline"
                          size={20}
                          color={colors.muted}
                          accessibilityElementsHidden
                          importantForAccessibility="no"
                        />
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={`Discard ${entry.meal_tag} food entry`}
                        accessibilityState={{
                          disabled: deletingFoodEntryId != null,
                        }}
                        disabled={deletingFoodEntryId != null}
                        onPress={() => {
                          onDeleteFoodEntry(entry.id);
                        }}
                        style={{
                          minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                          minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                        }}
                        className="items-center justify-center rounded-lg border border-red-400 px-2 active:opacity-80 disabled:opacity-60 dark:border-red-500/60"
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        {deletingFoodEntryId === entry.id ? (
                          <Text
                            className="text-xs font-semibold text-red-700 dark:text-red-300"
                            maxFontSizeMultiplier={2}
                          >
                            ...
                          </Text>
                        ) : (
                          <Ionicons
                            name="trash-outline"
                            size={20}
                            color={colors.error}
                            accessibilityElementsHidden
                            importantForAccessibility="no"
                          />
                        )}
                      </Pressable>
                    </View>
                  ) : null}
                  {editingFoodEntryId === entry.id ? (
                    <View className="mt-3 rounded-lg border border-app-border p-3 dark:border-app-border-dark">
                      <Text
                        className={`mb-2 text-base font-semibold ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      >
                        Edit food entry
                      </Text>
                      <View
                        accessibilityLabel="Meal tag"
                        className="mb-3 gap-2"
                      >
                        {MEAL_TAGS.map((tag) => (
                          <Pressable
                            key={`${entry.id}-${tag}`}
                            accessibilityRole="button"
                            accessibilityLabel={tag}
                            accessibilityState={{
                              selected: mealTag === tag,
                              disabled: savingFoodDiary,
                            }}
                            disabled={savingFoodDiary}
                            onPress={() => {
                              setMealTag((prev) => (prev === tag ? null : tag));
                            }}
                            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                            className={`w-full items-center justify-center rounded-xl border-2 px-3 py-3 dark:border-app-border-dark ${
                              mealTag === tag
                                ? 'border-red-700 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                                : 'border-app-border bg-app-bg dark:bg-app-bg-dark'
                            }`}
                          >
                            <Text
                              className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                              maxFontSizeMultiplier={2}
                            >
                              {tag}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                      <Text
                        className={`mb-1 text-base font-medium ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      >
                        Logged date
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Logged date"
                        accessibilityState={{ disabled: savingFoodDiary }}
                        disabled={savingFoodDiary}
                        onPress={() => {
                          setFoodDatePickerOpen((prev) => !prev);
                          setFoodTimePickerOpen(false);
                        }}
                        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                        className="mb-3 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                      >
                        <Text
                          className={`text-[17px] ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        >
                          {foodLoggedDateLabel}
                        </Text>
                      </Pressable>
                      <Text
                        className={`mb-1 text-base font-medium ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      >
                        Logged time
                      </Text>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Logged time"
                        accessibilityState={{ disabled: savingFoodDiary }}
                        disabled={savingFoodDiary}
                        onPress={() => {
                          setFoodTimePickerOpen((prev) => !prev);
                          setFoodDatePickerOpen(false);
                        }}
                        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                        className="mb-4 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                      >
                        <Text
                          className={`text-[17px] ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        >
                          {foodLoggedTimeLabel}
                        </Text>
                      </Pressable>
                      <Text
                        className={`mb-1 text-base font-medium ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      >
                        Food note
                      </Text>
                      <TextInput
                        editable={!savingFoodDiary}
                        accessibilityLabel="Food note"
                        multiline
                        value={foodNote}
                        onChangeText={setFoodNote}
                        placeholder="What did you eat or drink?"
                        placeholderTextColor={colors.inputPlaceholder}
                        className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      />
                      {foodDiaryFeedback ? (
                        <Text
                          className={`mb-2 text-sm ${nw.textError}`}
                          accessibilityLiveRegion="assertive"
                          maxFontSizeMultiplier={2}
                        >
                          {foodDiaryFeedback}
                        </Text>
                      ) : null}
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          savingFoodDiary
                            ? 'Saving food diary entry'
                            : 'Update food entry'
                        }
                        accessibilityState={{ disabled: savingFoodDiary }}
                        disabled={savingFoodDiary}
                        onPress={() => {
                          void onSaveFoodDiary();
                        }}
                        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                        className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 disabled:opacity-60 dark:bg-red-600"
                      >
                        <Text className="text-center text-[17px] font-semibold text-white">
                          {savingFoodDiary ? 'Saving…' : 'Update entry'}
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Cancel food entry edit"
                        onPress={onDiscardFoodEditChanges}
                        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                        className="mt-3 w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
                      >
                        <Text
                          className={`text-base font-medium ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        >
                          Discard changes
                        </Text>
                      </Pressable>
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel="Discard saved food entry"
                        accessibilityState={{
                          disabled: deletingFoodEntryId != null,
                        }}
                        disabled={deletingFoodEntryId != null}
                        onPress={() => {
                          onDeleteFoodEntry(entry.id);
                        }}
                        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                        className="mt-3 w-full items-center justify-center rounded-lg border border-red-400 px-3 py-3 active:opacity-80 disabled:opacity-60 dark:border-red-500/60"
                      >
                        <Text
                          className="text-base font-medium text-red-700 dark:text-red-300"
                          maxFontSizeMultiplier={2}
                        >
                          {deletingFoodEntryId === entry.id
                            ? 'Discarding…'
                            : 'Discard entry'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              ))}
              {editingFoodEntryId == null && !isAddFoodEntryOpen ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Add food entry"
                  onPress={onNewFoodEntry}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
                >
                  <Text
                    className={`text-base font-medium ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Add food entry
                  </Text>
                </Pressable>
              ) : null}
              {editingFoodEntryId == null && isAddFoodEntryOpen ? (
                <>
                  <Text
                    accessibilityRole="header"
                    className={`mb-2 text-lg font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Add food entry
                  </Text>
                  <View accessibilityLabel="Meal tag" className="mb-4 gap-2">
                    {MEAL_TAGS.map((tag) => (
                      <Pressable
                        key={`add-${tag}`}
                        accessibilityRole="button"
                        accessibilityLabel={tag}
                        accessibilityState={{
                          selected: mealTag === tag,
                          disabled: savingFoodDiary,
                        }}
                        disabled={savingFoodDiary}
                        onPress={() => {
                          const nextMealTag = mealTag === tag ? null : tag;
                          setMealTag(nextMealTag);
                          setIsAddFoodEntryDirty(
                            computeIsAddFoodEntryDirty({
                              mealTag: nextMealTag,
                              foodNote,
                              foodLoggedDate,
                              foodLoggedTime,
                            }),
                          );
                        }}
                        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                        className={`w-full items-center justify-center rounded-xl border-2 px-3 py-3 dark:border-app-border-dark ${
                          mealTag === tag
                            ? 'border-red-700 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                            : 'border-app-border bg-app-bg dark:bg-app-bg-dark'
                        }`}
                      >
                        <Text
                          className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        >
                          {tag}
                        </Text>
                      </Pressable>
                    ))}
                  </View>
                  <Text
                    className={`mb-1 text-base font-medium ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Logged date
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Logged date"
                    accessibilityState={{ disabled: savingFoodDiary }}
                    disabled={savingFoodDiary}
                    onPress={() => {
                      setFoodDatePickerOpen((prev) => !prev);
                      setFoodTimePickerOpen(false);
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="mb-3 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                  >
                    <Text
                      className={`text-[17px] ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {foodLoggedDateLabel}
                    </Text>
                  </Pressable>
                  <Text
                    className={`mb-1 text-base font-medium ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Logged time
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Logged time"
                    accessibilityState={{ disabled: savingFoodDiary }}
                    disabled={savingFoodDiary}
                    onPress={() => {
                      setFoodTimePickerOpen((prev) => !prev);
                      setFoodDatePickerOpen(false);
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="mb-4 items-center justify-center rounded-xl border border-app-border bg-white px-4 py-3 dark:border-app-border-dark dark:bg-app-bg-dark"
                  >
                    <Text
                      className={`text-[17px] ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {foodLoggedTimeLabel}
                    </Text>
                  </Pressable>
                  <Text
                    className={`mb-1 text-base font-medium ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Food note
                  </Text>
                  <TextInput
                    editable={!savingFoodDiary}
                    accessibilityLabel="Food note"
                    multiline
                    value={foodNote}
                    onChangeText={(value) => {
                      setFoodNote(value);
                      setIsAddFoodEntryDirty(
                        computeIsAddFoodEntryDirty({
                          mealTag,
                          foodNote: value,
                          foodLoggedDate,
                          foodLoggedTime,
                        }),
                      );
                    }}
                    placeholder="What did you eat or drink?"
                    placeholderTextColor={colors.inputPlaceholder}
                    className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  />
                  {foodDiaryFeedback ? (
                    <Text
                      className={`mb-2 text-sm ${nw.textError}`}
                      accessibilityLiveRegion="assertive"
                      maxFontSizeMultiplier={2}
                    >
                      {foodDiaryFeedback}
                    </Text>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      savingFoodDiary
                        ? 'Saving food diary entry'
                        : 'Save food entry'
                    }
                    accessibilityState={{ disabled: savingFoodDiary }}
                    disabled={savingFoodDiary}
                    onPress={() => {
                      void onSaveFoodDiary();
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 disabled:opacity-60 dark:bg-red-600"
                  >
                    <Text className="text-center text-[17px] font-semibold text-white">
                      {savingFoodDiary ? 'Saving…' : 'Save entry'}
                    </Text>
                  </Pressable>
                  {isAddFoodEntryDirty ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Discard food entry"
                      onPress={onDiscardAddFoodDraft}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className="mt-3 w-full items-center justify-center rounded-lg border border-red-400 px-3 py-3 active:opacity-80 dark:border-red-500/60"
                    >
                      <Text
                        className="text-base font-medium text-red-700 dark:text-red-300"
                        maxFontSizeMultiplier={2}
                      >
                        Discard entry
                      </Text>
                    </Pressable>
                  ) : null}
                  {!isAddFoodEntryDirty ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Collapse add food entry"
                      onPress={() => {
                        setIsAddFoodEntryOpen(false);
                      }}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className="mt-3 w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
                    >
                      <Text
                        className={`text-base font-medium ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      >
                        Collapse
                      </Text>
                    </Pressable>
                  ) : null}
                </>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back to health markers"
                onPress={() => {
                  void onBackToHealthMarkersFromFoodDiary();
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="w-full items-center justify-center rounded-lg border border-app-border px-3 py-3 active:opacity-80 dark:border-app-border-dark"
              >
                <Text
                  className={`text-base font-medium ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  Back
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  foodEntriesError != null
                    ? 'Continue disabled until food entries load successfully'
                    : foodEntries.length === 0
                      ? 'Skip food diary entry'
                      : 'Continue after food diary'
                }
                accessibilityState={{ disabled: foodDiaryContinueDisabled }}
                disabled={foodDiaryContinueDisabled}
                onPress={() => {
                  void onContinueFromFoodDiary();
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className={`w-full items-center justify-center rounded-lg bg-red-700 px-3 py-3 active:opacity-90 dark:bg-red-600 ${
                  foodDiaryContinueDisabled ? 'opacity-50' : ''
                } ${
                  editingFoodEntryId == null && !isAddFoodEntryOpen
                    ? 'mt-5'
                    : 'mt-3'
                }`}
              >
                <Text
                  className="text-center text-base font-semibold text-white"
                  maxFontSizeMultiplier={2}
                >
                  {foodEntries.length === 0 ? 'Skip for now' : 'Continue'}
                </Text>
              </Pressable>
            </ScrollView>
            {foodDatePickerOpen ? (
              <DateTimePicker
                value={foodLoggedDateTimeValue}
                mode="date"
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onFoodDatePickerChange}
              />
            ) : null}
            {foodTimePickerOpen ? (
              <DateTimePicker
                value={foodLoggedDateTimeValue}
                mode="time"
                is24Hour={false}
                display={Platform.OS === 'ios' ? 'spinner' : 'default'}
                onChange={onFoodTimePickerChange}
              />
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel episode"
              onPress={onCancelEpisodePress}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
            >
              <Text
                className="text-sm font-medium text-red-700 dark:text-red-300"
                maxFontSizeMultiplier={2}
              >
                Cancel episode
              </Text>
            </Pressable>
          </>
        ) : phase === 'postMarkers' ? (
          <>
            <ScrollView
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 24 }}
            >
              <Text
                className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                After health markers and food diary, choose ABS or Other; other
                fields are optional.
              </Text>
              <Text
                accessibilityRole="header"
                className={`mb-2 text-lg font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Episode type
              </Text>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Episode type"
                className="mb-4 gap-3"
              >
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel="ABS episode type"
                  accessibilityState={{
                    checked: postEpisodeKind === 'ABS',
                    disabled: savingPost,
                  }}
                  onPress={() => {
                    setPostEpisodeKind('ABS');
                  }}
                  disabled={savingPost}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className={`w-full items-center justify-center rounded-xl border-2 px-3 py-4 dark:border-app-border-dark ${
                    postEpisodeKind === 'ABS'
                      ? 'border-red-700 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                      : 'border-app-border bg-app-bg dark:bg-app-bg-dark'
                  }`}
                >
                  <Text
                    className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    ABS
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="radio"
                  accessibilityLabel="Other episode type"
                  accessibilityState={{
                    checked: postEpisodeKind === 'Other',
                    disabled: savingPost,
                  }}
                  onPress={() => {
                    setPostEpisodeKind('Other');
                  }}
                  disabled={savingPost}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className={`w-full items-center justify-center rounded-xl border-2 px-3 py-4 dark:border-app-border-dark ${
                    postEpisodeKind === 'Other'
                      ? 'border-red-700 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                      : 'border-app-border bg-app-bg dark:bg-app-bg-dark'
                  }`}
                >
                  <Text
                    className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Other
                  </Text>
                </Pressable>
              </View>
              {bacSuggestAbs && postEpisodeKind === 'ABS' ? (
                <Text
                  className={`mb-4 text-sm ${nw.textMuted}`}
                  accessibilityLiveRegion="polite"
                  maxFontSizeMultiplier={2}
                >
                  Suggested as ABS because a BAC value above zero was logged.
                  You can change this.
                </Text>
              ) : null}
              <Text
                accessibilityRole="text"
                className={`mb-1 text-base font-medium ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Custom label (optional)
              </Text>
              <TextInput
                editable={!savingPost}
                accessibilityLabel="Custom episode label"
                value={postLabel}
                onChangeText={setPostLabel}
                placeholder="Label"
                placeholderTextColor={colors.inputPlaceholder}
                className={`mb-4 min-h-[52px] rounded-xl border border-app-border bg-white px-4 py-3 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              />
              <Text
                accessibilityRole="text"
                className={`mb-1 text-base font-medium ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Additional symptoms or markers (optional)
              </Text>
              <TextInput
                editable={!savingPost}
                accessibilityLabel="Additional symptoms or markers"
                multiline
                value={postAdditional}
                onChangeText={setPostAdditional}
                placeholder="Not in your presets"
                placeholderTextColor={colors.inputPlaceholder}
                className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              />
              <Text
                accessibilityRole="text"
                className={`mb-1 text-base font-medium ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Episode note (optional)
              </Text>
              <TextInput
                editable={!savingPost}
                accessibilityLabel="Episode note"
                multiline
                value={postNote}
                onChangeText={setPostNote}
                placeholder="General note"
                placeholderTextColor={colors.inputPlaceholder}
                className={`mb-4 min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              />
              {postFeedback ? (
                <Text
                  className="mb-2 text-sm text-red-700 dark:text-red-300"
                  accessibilityLiveRegion="assertive"
                  maxFontSizeMultiplier={2}
                >
                  {postFeedback}
                </Text>
              ) : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Back"
                accessibilityState={{ disabled: savingPost }}
                disabled={savingPost}
                onPress={() => {
                  void onBackToFoodDiaryFromPostMarkers();
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark"
              >
                <Text
                  className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                >
                  Back
                </Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Save episode details"
                accessibilityState={{ disabled: savingPost }}
                disabled={savingPost}
                onPress={() => {
                  void onSubmitPostMarkers();
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 dark:bg-red-600"
              >
                <Text className="text-center text-[17px] font-semibold text-white">
                  {savingPost ? 'Saving…' : 'Save and continue'}
                </Text>
              </Pressable>
            </ScrollView>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel episode"
              onPress={onCancelEpisodePress}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
            >
              <Text
                className="text-sm font-medium text-red-700 dark:text-red-300"
                maxFontSizeMultiplier={2}
              >
                Cancel episode
              </Text>
            </Pressable>
          </>
        ) : (
          <>
            <AsyncScreenContainer
              status={status}
              loadingAccessibilityLabel="Loading health marker list"
              errorTitle="Could not load health markers"
              errorMessage={errorMessage ?? undefined}
              onRetry={() => {
                void load();
              }}
            >
              <ScrollView
                className="flex-1"
                keyboardShouldPersistTaps="handled"
                contentContainerStyle={{ paddingBottom: 24 }}
              >
                <Text
                  accessibilityRole="text"
                  className={`mb-2 text-base font-medium ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  {lines.length === 0
                    ? 'Next: episode details (after this screen)'
                    : `Step ${activeIndex + 1} of ${lines.length}`}
                </Text>

                {lines.length === 0 ? (
                  <Text
                    className={`text-base leading-relaxed ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    This preset has no health marker lines to log—that is normal
                    for some templates. Use the button below to continue and add
                    episode type, optional label, and notes.
                  </Text>
                ) : currentLine ? (
                  <View className="gap-4">
                    <Text
                      accessibilityRole="header"
                      className={`text-xl font-semibold ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {markerLineTitle(currentLine)}
                    </Text>
                    {currentLine.custom_unit ? (
                      <Text
                        className={`text-base leading-relaxed ${nw.textMuted}`}
                        maxFontSizeMultiplier={2}
                      >
                        Unit: {currentLine.custom_unit}
                      </Text>
                    ) : null}
                    {currentLine.marker_kind === 'blood_pressure' ? (
                      <View className="gap-3">
                        <TextInput
                          editable={!saving}
                          accessibilityLabel="Systolic value"
                          keyboardType="decimal-pad"
                          value={currentDraft.systolic}
                          onChangeText={(text) => {
                            onUpdateDraft({ systolic: text });
                          }}
                          placeholder="Systolic"
                          placeholderTextColor={colors.inputPlaceholder}
                          className={`min-h-[52px] rounded-xl border border-app-border bg-white px-4 py-3 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        />
                        <TextInput
                          editable={!saving}
                          accessibilityLabel="Diastolic value"
                          keyboardType="decimal-pad"
                          value={currentDraft.diastolic}
                          onChangeText={(text) => {
                            onUpdateDraft({ diastolic: text });
                          }}
                          placeholder="Diastolic"
                          placeholderTextColor={colors.inputPlaceholder}
                          className={`min-h-[52px] rounded-xl border border-app-border bg-white px-4 py-3 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        />
                      </View>
                    ) : (
                      <TextInput
                        editable={!saving}
                        accessibilityLabel="Marker value"
                        keyboardType="decimal-pad"
                        value={currentDraft.value}
                        onChangeText={(text) => {
                          onUpdateDraft({ value: text });
                        }}
                        placeholder="Enter value"
                        placeholderTextColor={colors.inputPlaceholder}
                        className={`min-h-[52px] rounded-xl border border-app-border bg-white px-4 py-3 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      />
                    )}
                    <TextInput
                      editable={!saving}
                      accessibilityLabel="Marker notes"
                      multiline
                      value={currentDraft.notes}
                      onChangeText={(text) => {
                        onUpdateDraft({ notes: text });
                      }}
                      placeholder="Notes (optional)"
                      placeholderTextColor={colors.inputPlaceholder}
                      className={`min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    />
                  </View>
                ) : null}

                <View className="mt-6 gap-3">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Back"
                    onPress={() => {
                      if (activeIndex > 0) {
                        goBackStep();
                        return;
                      }
                      void onBackToSymptomsFromHealthMarkers();
                    }}
                    disabled={saving}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark"
                  >
                    <Text
                      className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      Back
                    </Text>
                  </Pressable>
                  {currentLine ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Skip this marker"
                      accessibilityState={{ disabled: !canSkip || saving }}
                      disabled={!canSkip || saving}
                      onPress={() => {
                        void skipCurrent();
                      }}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className={`w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 dark:border-app-border-dark dark:bg-app-bg-dark ${
                        skipPressable ? 'active:opacity-90' : 'opacity-50'
                      }`}
                    >
                      <Text
                        className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                        maxFontSizeMultiplier={2}
                      >
                        Skip
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      continueToFoodDiary
                        ? 'Continue to food diary'
                        : 'Next health marker'
                    }
                    accessibilityState={{ disabled: saving }}
                    disabled={saving}
                    onPress={() => {
                      void goNext();
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="w-full items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 dark:bg-red-600"
                  >
                    <Text className="text-center text-[17px] font-semibold text-white">
                      {saving
                        ? 'Saving…'
                        : continueToFoodDiary
                          ? 'Continue to food diary'
                          : 'Next'}
                    </Text>
                  </Pressable>
                </View>
              </ScrollView>
            </AsyncScreenContainer>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel episode"
              onPress={onCancelEpisodePress}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
            >
              <Text
                className="text-sm font-medium text-red-700 dark:text-red-300"
                maxFontSizeMultiplier={2}
              >
                Cancel episode
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ScreenShell>
  );
}
