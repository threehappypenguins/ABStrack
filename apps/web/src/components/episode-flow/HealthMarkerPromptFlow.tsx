'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  EpisodeRow,
  EpisodeType,
  FoodDiaryEntryRow,
  HealthMarkerRow,
  MealTag,
  PresetHealthMarkerKind,
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
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { clearSymptomPromptSession } from '@/lib/episode-flow/symptom-prompt-session-store';
import {
  localInputValueToIso,
  toLocalDateTimeInputValue,
} from '@/lib/food-diary/date-time';
import { EpisodeLocaleInstant } from '@/components/episodes/EpisodeLocaleInstant';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';

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

/**
 * HTML `min` for preset kinds with non-negative vitals; `custom` stays unconstrained (scales vary).
 * Pair with `step="any"` so decimals still validate in browsers.
 */
function minForPresetMarkerValueInput(
  kind: PresetHealthMarkerKind,
): number | undefined {
  return kind === 'custom' ? undefined : 0;
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
 * Parses numeric fields the same way as {@link saveCurrentLine} (single source of truth).
 * Skip is allowed whenever this returns `ok: false` (incomplete or invalid measurement).
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

export type HealthMarkerPromptFlowProps = {
  episodeId: string;
  resumeFromEntry?: boolean;
};

/**
 * Linear in-episode health marker stepper that runs after symptom prompts.
 *
 * @param props - Episode id and optional resume intent.
 * @returns Marker prompt UI with per-line manual entry and persistence.
 */
export function HealthMarkerPromptFlow({
  episodeId,
  resumeFromEntry = false,
}: HealthMarkerPromptFlowProps) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const supabase = useMemo(() => createBrowserClient(), []);

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
  const [postEpisodeKind, setPostEpisodeKind] = useState<EpisodeType>('Other');
  const [postLabel, setPostLabel] = useState('');
  const [postAdditional, setPostAdditional] = useState('');
  const [postNote, setPostNote] = useState('');
  const [savingPost, setSavingPost] = useState(false);
  const [postFeedback, setPostFeedback] = useState<string | null>(null);
  const [foodDiaryDecision, setFoodDiaryDecision] = useState<
    'pending' | 'saved' | 'skipped'
  >('pending');
  const [foodEntries, setFoodEntries] = useState<FoodDiaryEntryRow[]>([]);
  const [foodEntriesLoading, setFoodEntriesLoading] = useState(false);
  const [foodEntriesError, setFoodEntriesError] = useState<string | null>(null);
  const [foodMealTag, setFoodMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const initialFoodLoggedAtLocalRef = useRef(
    toLocalDateTimeInputValue(new Date().toISOString()),
  );
  const [foodLoggedAtLocal, setFoodLoggedAtLocal] = useState(
    initialFoodLoggedAtLocalRef.current,
  );
  const [addFoodInitialLoggedAtLocal, setAddFoodInitialLoggedAtLocal] =
    useState(initialFoodLoggedAtLocalRef.current);
  const [foodSaving, setFoodSaving] = useState(false);
  const [foodSaveError, setFoodSaveError] = useState<string | null>(null);
  const [editingFoodEntryId, setEditingFoodEntryId] = useState<string | null>(
    null,
  );
  const [deletingFoodEntryId, setDeletingFoodEntryId] = useState<string | null>(
    null,
  );
  const [isAddFoodEntryOpen, setIsAddFoodEntryOpen] = useState(true);
  const [isAddFoodEntryDirty, setIsAddFoodEntryDirty] = useState(false);
  const [endingEpisode, setEndingEpisode] = useState(false);
  const [endDialogOpen, setEndDialogOpen] = useState(false);
  const [endFeedback, setEndFeedback] = useState<string | null>(null);
  const [endedSummary, setEndedSummary] = useState<{
    endedAt: string;
    durationText: string | null;
  } | null>(null);
  const postFormInitRef = useRef(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelingEpisode, setCancelingEpisode] = useState(false);
  const [episodeRow, setEpisodeRow] = useState<EpisodeRow | null>(null);
  const loadGenRef = useRef(0);

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

  const load = useCallback(async () => {
    const loadGen = ++loadGenRef.current;
    const isStale = () => loadGen !== loadGenRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistFeedback(null);
    setPhase('prompting');
    postFormInitRef.current = false;
    setPostFeedback(null);
    setFoodDiaryDecision('pending');
    setFoodEntries([]);
    setFoodEntriesError(null);
    setFoodEntriesLoading(false);
    setFoodMealTag(null);
    setFoodNote('');
    const initialFoodLoggedAtLocal = toLocalDateTimeInputValue(
      new Date().toISOString(),
    );
    setFoodLoggedAtLocal(initialFoodLoggedAtLocal);
    setAddFoodInitialLoggedAtLocal(initialFoodLoggedAtLocal);
    setFoodSaving(false);
    setFoodSaveError(null);
    setEditingFoodEntryId(null);
    setIsAddFoodEntryOpen(true);
    setEndFeedback(null);
    setEndedSummary(null);
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (isStale()) {
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
    if (isStale()) {
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
        'This episode has no health marker preset linked. Return to the dashboard and start a new episode template.',
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
    if (isStale()) {
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
    // enterFoodDiaryPhaseAfterMarkers before the food diary step.
    setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));

    const firstUnanswered = presetLines.data.findIndex((line) => {
      const row = findExistingMarkerForLine(markerRows.data, line);
      return row === null;
    });
    if (resumeFromEntry) {
      if (firstUnanswered === -1) {
        if (episode.data?.post_marker_step_completed_at) {
          setPhase('complete');
        } else {
          setPhase('foodDiary');
        }
      } else {
        setActiveIndex(firstUnanswered);
      }
    } else {
      setActiveIndex(0);
    }
    setStatus('ready');
  }, [episodeId, resumeFromEntry, supabase]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  const currentLine = lines[activeIndex] ?? null;
  const currentDraft = currentLine
    ? (drafts[currentLine.id] ?? createDraftFromMarker(null))
    : createDraftFromMarker(null);
  const measurementReadyForSave = currentLine
    ? parseMeasurementDraftForSave(currentLine, currentDraft).ok
    : false;
  const canSkip = Boolean(currentLine) && !measurementReadyForSave;
  const skipPressable = canSkip && !saving;
  const continueToFoodDiary =
    lines.length === 0 || activeIndex >= lines.length - 1;

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
      announce(customValidation, { politeness: 'assertive' });
      return false;
    }

    const parsed = parseMeasurementDraftForSave(currentLine, currentDraft);
    if (!parsed.ok) {
      setPersistFeedback({
        source: 'validation',
        message: parsed.message,
      });
      announce(parsed.message, { politeness: 'assertive' });
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
      announce(`Could not sync with the server: ${result.error.message}`, {
        politeness: 'assertive',
      });
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
      announce(
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
      announce('Health marker list complete.', { politeness: 'polite' });
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
      announce('Health marker list complete.', { politeness: 'polite' });
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
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    setEpisodeRow(result.data);
    setEndFeedback(null);
    setEndedSummary(null);
    setPhase('complete');
    announce('Episode details saved.', { politeness: 'polite' });
  };

  const resetFoodForm = useCallback(() => {
    const initialFoodLoggedAtLocal = toLocalDateTimeInputValue(
      new Date().toISOString(),
    );
    setEditingFoodEntryId(null);
    setFoodMealTag(null);
    setFoodNote('');
    setFoodLoggedAtLocal(initialFoodLoggedAtLocal);
    setAddFoodInitialLoggedAtLocal(initialFoodLoggedAtLocal);
    setFoodSaveError(null);
    setIsAddFoodEntryDirty(false);
  }, []);

  const computeIsAddFoodEntryDirty = useCallback(
    (next: {
      mealTag: MealTag | null;
      note: string;
      loggedAtLocal: string;
    }) => {
      return (
        next.mealTag != null ||
        next.note.trim().length > 0 ||
        next.loggedAtLocal !== addFoodInitialLoggedAtLocal
      );
    },
    [addFoodInitialLoggedAtLocal],
  );

  const onDiscardAddFoodDraft = () => {
    if (!isAddFoodEntryDirty) {
      setIsAddFoodEntryOpen(false);
      return;
    }
    const shouldDiscard = window.confirm(
      'Discard this food entry draft? Your unsaved entry will be removed.',
    );
    if (!shouldDiscard) {
      return;
    }
    resetFoodForm();
    setIsAddFoodEntryOpen(false);
  };

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

  useEffect(() => {
    if (phase !== 'foodDiary') {
      return;
    }
    void loadFoodEntries();
  }, [phase, loadFoodEntries]);

  const onEditFoodEntry = (entry: FoodDiaryEntryRow) => {
    setEditingFoodEntryId(entry.id);
    setIsAddFoodEntryOpen(false);
    setFoodMealTag(entry.meal_tag);
    setFoodNote(entry.food_note);
    setFoodLoggedAtLocal(toLocalDateTimeInputValue(entry.logged_at));
    setFoodSaveError(null);
  };

  const onSaveFoodEntry = async () => {
    if (foodSaving || !userId) {
      return;
    }
    setFoodSaving(true);
    setFoodSaveError(null);
    if (!foodMealTag) {
      const message = 'Choose a meal tag.';
      setFoodSaveError(message);
      announce(message, { politeness: 'assertive' });
      setFoodSaving(false);
      return;
    }
    const loggedAtIso = localInputValueToIso(foodLoggedAtLocal);
    if (!loggedAtIso) {
      const message = 'Enter a valid date and time.';
      setFoodSaveError(message);
      announce(message, { politeness: 'assertive' });
      setFoodSaving(false);
      return;
    }

    const result =
      editingFoodEntryId == null
        ? await createFoodDiaryEntry(supabase, {
            user_id: userId,
            episode_id: episodeId,
            meal_tag: foodMealTag,
            food_note: foodNote,
            logged_at: loggedAtIso,
          })
        : await updateFoodDiaryEntry(supabase, editingFoodEntryId, {
            meal_tag: foodMealTag,
            food_note: foodNote,
            logged_at: loggedAtIso,
          });
    setFoodSaving(false);
    if (!result.ok) {
      setFoodSaveError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    await loadFoodEntries();
    resetFoodForm();
    if (editingFoodEntryId == null) {
      setIsAddFoodEntryOpen(false);
    }
    announce(
      editingFoodEntryId == null ? 'Food entry saved.' : 'Food entry updated.',
      { politeness: 'polite' },
    );
  };

  const onDeleteFoodEntry = async (entryId: string) => {
    if (foodSaving || deletingFoodEntryId) {
      return;
    }
    const shouldDelete = window.confirm(
      'Discard this saved food entry? This cannot be undone.',
    );
    if (!shouldDelete) {
      return;
    }
    setDeletingFoodEntryId(entryId);
    setFoodSaveError(null);
    const result = await deleteFoodDiaryEntry(supabase, entryId);
    setDeletingFoodEntryId(null);
    if (!result.ok) {
      setFoodSaveError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    if (editingFoodEntryId === entryId) {
      resetFoodForm();
    }
    await loadFoodEntries();
    announce('Food entry discarded.', { politeness: 'polite' });
  };

  const onContinueFromFoodDiary = () => {
    if (foodSaving || deletingFoodEntryId != null || foodEntriesLoading) {
      return;
    }
    setFoodDiaryDecision(foodEntries.length > 0 ? 'saved' : 'skipped');
    setPhase('postMarkers');
  };

  const onBackToHealthMarkersFromFoodDiary = () => {
    setPhase('prompting');
    announce('Returned to health markers.', { politeness: 'polite' });
  };

  const onBackToSymptomsFromHealthMarkers = useCallback(() => {
    const symptomPresetId = episodeRow?.symptom_preset_id;
    if (!symptomPresetId) {
      const message =
        'This episode has no symptom preset linked, so symptoms cannot be reopened.';
      announce(message, { politeness: 'assertive' });
      return;
    }
    const query = new URLSearchParams();
    query.set('symptomPresetId', symptomPresetId);
    query.set('resume', '1');
    router.push(`/episode/${episodeId}/symptoms?${query.toString()}`);
  }, [announce, episodeId, episodeRow, router]);

  const onBackToFoodDiaryFromPostMarkers = () => {
    setPhase('foodDiary');
    announce('Returned to food diary.', { politeness: 'polite' });
  };

  const onFinishToDashboard = () => {
    router.push('/dashboard');
  };

  const onEndEpisode = useCallback(async (): Promise<void> => {
    if (endingEpisode) {
      return;
    }
    if (!episodeRow) {
      const message = 'Could not find this episode. Please try again.';
      setEndDialogOpen(false);
      setEndFeedback(message);
      announce(message, { politeness: 'assertive' });
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
        setEndDialogOpen(false);
        setEndFeedback(result.error.message);
        announce(result.error.message, { politeness: 'assertive' });
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
        announce(
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
        announce('This episode was already ended.', { politeness: 'polite' });
        return;
      }
      const message =
        'This episode is no longer active. Return to dashboard and refresh episodes.';
      setEndDialogOpen(false);
      setEndFeedback(message);
      announce(message, { politeness: 'assertive' });
      return;
    } finally {
      setEndingEpisode(false);
    }
  }, [announce, endingEpisode, episodeId, episodeRow, supabase]);

  const onCancelEpisodeConfirm = async (): Promise<void | false> => {
    if (cancelingEpisode) {
      return false;
    }
    setCancelingEpisode(true);
    try {
      const result = await cancelActiveEpisodeById(supabase, episodeId);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      clearSymptomPromptSession(episodeId);
      if (result.data.didCancel) {
        announce('Episode canceled. Resume is no longer available.', {
          politeness: 'polite',
        });
      } else {
        announce('This episode is no longer active.', { politeness: 'polite' });
      }
      router.push('/dashboard');
      return;
    } finally {
      setCancelingEpisode(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode health markers
        </h1>
        <p className="text-sm text-app-muted" role="status">
          Loading health marker list…
        </p>
      </div>
    );
  }

  if (status === 'error' && errorMessage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode health markers
        </h1>
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {errorMessage}
        </p>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => {
            void load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'postMarkers') {
    return (
      <>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-app-ink">
              Episode details
            </h1>
            <p className="mt-2 text-base text-app-muted">
              After health markers and food diary, add any extra context. Choose
              ABS or Other; other fields are optional.
            </p>
          </div>

          <fieldset className="space-y-3" disabled={savingPost}>
            <legend className="text-base font-semibold text-app-ink">
              Episode type
            </legend>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border border-app-border bg-app-surface px-4 py-3 shadow-sm has-[:checked]:ring-2 has-[:checked]:ring-app-ring ${
                  savingPost
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  className="h-5 w-5"
                  name="episodeType"
                  checked={postEpisodeKind === 'ABS'}
                  disabled={savingPost}
                  onChange={() => {
                    if (savingPost) {
                      return;
                    }
                    setPostEpisodeKind('ABS');
                  }}
                />
                <span className="text-base font-medium text-app-ink">ABS</span>
              </label>
              <label
                className={`flex min-h-[56px] items-center gap-3 rounded-xl border border-app-border bg-app-surface px-4 py-3 shadow-sm has-[:checked]:ring-2 has-[:checked]:ring-app-ring ${
                  savingPost
                    ? 'cursor-not-allowed opacity-60'
                    : 'cursor-pointer'
                }`}
              >
                <input
                  type="radio"
                  className="h-5 w-5"
                  name="episodeType"
                  checked={postEpisodeKind === 'Other'}
                  disabled={savingPost}
                  onChange={() => {
                    if (savingPost) {
                      return;
                    }
                    setPostEpisodeKind('Other');
                  }}
                />
                <span className="text-base font-medium text-app-ink">
                  Other
                </span>
              </label>
            </div>
            {bacSuggestAbs && postEpisodeKind === 'ABS' ? (
              <p className="text-sm text-app-muted" role="status">
                Suggested as ABS because a BAC value above zero was logged. You
                can change this.
              </p>
            ) : null}
          </fieldset>

          <label className="block space-y-1 text-sm font-medium text-app-ink">
            <span>Custom label (optional)</span>
            <input
              type="text"
              value={postLabel}
              disabled={savingPost}
              onChange={(e) => {
                setPostLabel(e.target.value);
              }}
              autoComplete="off"
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
            />
          </label>

          <label className="block space-y-1 text-sm font-medium text-app-ink">
            <span>Additional symptoms or markers (optional)</span>
            <textarea
              rows={3}
              value={postAdditional}
              disabled={savingPost}
              onChange={(e) => {
                setPostAdditional(e.target.value);
              }}
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
            />
          </label>

          <label className="block space-y-1 text-sm font-medium text-app-ink">
            <span>Episode note (optional)</span>
            <textarea
              rows={3}
              value={postNote}
              disabled={savingPost}
              onChange={(e) => {
                setPostNote(e.target.value);
              }}
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
            />
          </label>

          {postFeedback ? (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {postFeedback}
            </p>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row">
            <button
              type="button"
              className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg sm:w-auto"
              disabled={savingPost}
              onClick={onBackToFoodDiaryFromPostMarkers}
            >
              Back
            </button>
            <button
              type="button"
              className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500 sm:w-auto"
              disabled={savingPost}
              onClick={() => {
                void onSubmitPostMarkers();
              }}
            >
              {savingPost ? 'Saving…' : 'Save and continue'}
            </button>
          </div>

          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
            onClick={() => {
              setCancelDialogOpen(true);
            }}
            disabled={cancelingEpisode}
          >
            Cancel episode
          </button>
        </div>
        <ConfirmDialog
          open={cancelDialogOpen}
          title="Cancel this active episode?"
          description="Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone."
          confirmLabel="Cancel episode"
          confirmBusyLabel="Canceling episode…"
          cancelLabel="Keep episode"
          onConfirm={onCancelEpisodeConfirm}
          onClose={() => {
            setCancelDialogOpen(false);
          }}
        />
      </>
    );
  }

  if (phase === 'complete') {
    return (
      <>
        <div className="space-y-4">
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Episode health markers
          </h1>
          <div
            className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
            role="status"
            aria-live="polite"
          >
            {endedSummary ? (
              <div className="space-y-2">
                <p className="text-sm leading-relaxed text-app-ink">
                  This episode is ended and saved.
                </p>
                <p className="text-sm text-app-muted">
                  Ended <EpisodeLocaleInstant iso={endedSummary.endedAt} />
                </p>
                <p className="text-sm text-app-muted">
                  Duration {endedSummary.durationText ?? '—'}
                </p>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-app-ink">
                {foodDiaryDecision === 'saved'
                  ? 'Preset prompts, episode details, and food diary are saved. End this episode to prevent stale resume state.'
                  : 'Preset prompts and episode details are saved. End this episode to prevent stale resume state.'}
              </p>
            )}
          </div>
          {endFeedback ? (
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {endFeedback}
            </p>
          ) : null}
          {endedSummary ? (
            <button
              type="button"
              className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
              onClick={onFinishToDashboard}
            >
              Back to dashboard
            </button>
          ) : (
            <button
              type="button"
              className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
              onClick={() => {
                setEndDialogOpen(true);
              }}
              disabled={endingEpisode}
            >
              {endingEpisode ? 'Ending episode…' : 'End episode'}
            </button>
          )}
        </div>
        <ConfirmDialog
          open={endDialogOpen}
          title="End this episode now?"
          description="Ending sets this episode as complete and removes resume progress from this device. You can still view it in history."
          confirmLabel="End episode"
          confirmBusyLabel="Ending episode…"
          cancelLabel="Not yet"
          onConfirm={onEndEpisode}
          onClose={() => {
            setEndDialogOpen(false);
          }}
        />
      </>
    );
  }

  if (phase === 'foodDiary') {
    return (
      <>
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight text-app-ink">
              Food diary
            </h1>
            <p className="mt-2 text-base text-app-muted">
              Add one or more meals/snacks for this episode, or skip this step.
            </p>
          </div>

          <section className="space-y-3 rounded-2xl border border-app-border/90 bg-app-surface p-5 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
            <h2 className="text-base font-semibold text-app-ink">
              Saved entries
            </h2>
            {foodEntriesLoading ? (
              <p className="text-sm text-app-muted" role="status">
                Loading entries…
              </p>
            ) : null}
            {foodEntriesError ? (
              <p
                className="text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {foodEntriesError}
              </p>
            ) : null}
            {!foodEntriesLoading &&
            !foodEntriesError &&
            foodEntries.length === 0 ? (
              <p className="text-sm text-app-muted">
                No food entries yet for this episode.
              </p>
            ) : null}
            {!foodEntriesLoading && foodEntries.length > 0 ? (
              <div className="space-y-2">
                {foodEntries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-xl border border-app-border bg-app-surface px-3 py-3"
                  >
                    <p className="text-sm font-semibold text-app-ink">
                      {entry.meal_tag} -{' '}
                      <EpisodeLocaleInstant iso={entry.logged_at} />
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm text-app-muted">
                      {entry.food_note}
                    </p>
                    {editingFoodEntryId === entry.id ? (
                      <div className="mt-3 space-y-3 rounded-lg border border-app-border/80 p-3">
                        <fieldset className="space-y-2" disabled={foodSaving}>
                          <legend className="text-xs font-medium text-app-ink">
                            Meal tag
                          </legend>
                          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                            {MEAL_TAGS.map((tag) =>
                              foodMealTag === tag ? (
                                <button
                                  type="button"
                                  key={`edit-${entry.id}-${tag}`}
                                  aria-pressed="true"
                                  className="flex min-h-[40px] items-center justify-center rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-xs font-medium text-red-900 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100"
                                  disabled={foodSaving}
                                  onClick={() => {
                                    if (!foodSaving) {
                                      setFoodMealTag(null);
                                    }
                                  }}
                                >
                                  {tag}
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  key={`edit-${entry.id}-${tag}`}
                                  aria-pressed="false"
                                  className="flex min-h-[40px] cursor-pointer items-center justify-center rounded-lg border border-app-border bg-app-surface px-3 py-2 text-xs font-medium text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                                  disabled={foodSaving}
                                  onClick={() => {
                                    if (!foodSaving) {
                                      setFoodMealTag(tag);
                                    }
                                  }}
                                >
                                  {tag}
                                </button>
                              ),
                            )}
                          </div>
                        </fieldset>
                        <label className="block space-y-1 text-xs font-medium text-app-ink">
                          <span>Logged at</span>
                          <input
                            type="datetime-local"
                            value={foodLoggedAtLocal}
                            disabled={foodSaving}
                            onChange={(e) => {
                              setFoodLoggedAtLocal(e.target.value);
                            }}
                            className="min-h-[40px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                          />
                        </label>
                        <label className="block space-y-1 text-xs font-medium text-app-ink">
                          <span>Food note</span>
                          <textarea
                            rows={3}
                            value={foodNote}
                            disabled={foodSaving}
                            onChange={(e) => {
                              setFoodNote(e.target.value);
                            }}
                            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                          />
                        </label>
                        {foodSaveError ? (
                          <p
                            className="text-xs text-red-700 dark:text-red-300"
                            role="alert"
                          >
                            {foodSaveError}
                          </p>
                        ) : null}
                        <div className="flex gap-2">
                          <button
                            type="button"
                            className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-red-700 px-3 text-xs font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
                            disabled={foodSaving}
                            onClick={() => {
                              void onSaveFoodEntry();
                            }}
                          >
                            {foodSaving ? 'Saving…' : 'Update'}
                          </button>
                          <button
                            type="button"
                            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-app-border px-3 text-xs font-semibold text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                            onClick={resetFoodForm}
                          >
                            Discard changes
                          </button>
                          <button
                            type="button"
                            className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-red-400 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-950/30"
                            disabled={deletingFoodEntryId != null}
                            onClick={() => {
                              void onDeleteFoodEntry(entry.id);
                            }}
                          >
                            {deletingFoodEntryId === entry.id
                              ? 'Discarding…'
                              : 'Discard entry'}
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {editingFoodEntryId !== entry.id ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-app-border px-3 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                          onClick={() => {
                            onEditFoodEntry(entry);
                          }}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-red-400 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-950/30"
                          disabled={deletingFoodEntryId != null}
                          onClick={() => {
                            void onDeleteFoodEntry(entry.id);
                          }}
                        >
                          {deletingFoodEntryId === entry.id
                            ? 'Discarding…'
                            : 'Discard entry'}
                        </button>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}
          </section>

          {editingFoodEntryId == null && isAddFoodEntryOpen ? (
            <section className="space-y-4 rounded-2xl border border-app-border/90 bg-app-surface p-5 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
              <h2 className="text-base font-semibold text-app-ink">
                Add food entry
              </h2>
              <fieldset className="space-y-2" disabled={foodSaving}>
                <legend className="text-sm font-medium text-app-ink">
                  Meal tag
                </legend>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  {MEAL_TAGS.map((tag) =>
                    foodMealTag === tag ? (
                      <button
                        type="button"
                        key={`add-${tag}`}
                        aria-pressed="true"
                        className="flex min-h-[44px] items-center justify-center rounded-lg border border-red-700 bg-red-50 px-3 py-2 text-sm font-medium text-red-900 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100"
                        disabled={foodSaving}
                        onClick={() => {
                          if (!foodSaving) {
                            setFoodMealTag(null);
                            setIsAddFoodEntryDirty(
                              computeIsAddFoodEntryDirty({
                                mealTag: null,
                                note: foodNote,
                                loggedAtLocal: foodLoggedAtLocal,
                              }),
                            );
                          }
                        }}
                      >
                        {tag}
                      </button>
                    ) : (
                      <button
                        type="button"
                        key={`add-${tag}`}
                        aria-pressed="false"
                        className="flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm font-medium text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                        disabled={foodSaving}
                        onClick={() => {
                          if (!foodSaving) {
                            setFoodMealTag(tag);
                            setIsAddFoodEntryDirty(
                              computeIsAddFoodEntryDirty({
                                mealTag: tag,
                                note: foodNote,
                                loggedAtLocal: foodLoggedAtLocal,
                              }),
                            );
                          }
                        }}
                      >
                        {tag}
                      </button>
                    ),
                  )}
                </div>
              </fieldset>
              <label className="block space-y-1 text-sm font-medium text-app-ink">
                <span>Logged at</span>
                <input
                  type="datetime-local"
                  value={foodLoggedAtLocal}
                  disabled={foodSaving}
                  onChange={(e) => {
                    const nextLoggedAtLocal = e.target.value;
                    setFoodLoggedAtLocal(nextLoggedAtLocal);
                    setIsAddFoodEntryDirty(
                      computeIsAddFoodEntryDirty({
                        mealTag: foodMealTag,
                        note: foodNote,
                        loggedAtLocal: nextLoggedAtLocal,
                      }),
                    );
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                />
              </label>
              <label className="block space-y-1 text-sm font-medium text-app-ink">
                <span>Food note</span>
                <textarea
                  rows={3}
                  value={foodNote}
                  disabled={foodSaving}
                  onChange={(e) => {
                    const nextFoodNote = e.target.value;
                    setFoodNote(nextFoodNote);
                    setIsAddFoodEntryDirty(
                      computeIsAddFoodEntryDirty({
                        mealTag: foodMealTag,
                        note: nextFoodNote,
                        loggedAtLocal: foodLoggedAtLocal,
                      }),
                    );
                  }}
                  placeholder="What did you eat or drink?"
                  className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                />
              </label>
              {foodSaveError ? (
                <p
                  className="text-sm text-red-700 dark:text-red-300"
                  role="alert"
                >
                  {foodSaveError}
                </p>
              ) : null}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
                  disabled={foodSaving}
                  onClick={() => {
                    void onSaveFoodEntry();
                  }}
                >
                  {foodSaving ? 'Saving…' : 'Save entry'}
                </button>
                {isAddFoodEntryDirty ? (
                  <button
                    type="button"
                    className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-red-400 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-950/30"
                    onClick={onDiscardAddFoodDraft}
                  >
                    Discard entry
                  </button>
                ) : null}
                {!isAddFoodEntryDirty ? (
                  <button
                    type="button"
                    className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-app-border px-4 text-sm font-semibold text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    onClick={() => {
                      setIsAddFoodEntryOpen(false);
                    }}
                  >
                    Collapse
                  </button>
                ) : null}
              </div>
            </section>
          ) : null}

          <div
            className={`flex flex-wrap items-center gap-3 ${
              editingFoodEntryId == null && !isAddFoodEntryOpen
                ? 'mt-6'
                : 'mt-3'
            }`}
          >
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-app-border px-3 py-2 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={onBackToHealthMarkersFromFoodDiary}
            >
              Back
            </button>
            {editingFoodEntryId == null && !isAddFoodEntryOpen ? (
              <button
                type="button"
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-app-border px-3 py-2 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                onClick={() => {
                  resetFoodForm();
                  setIsAddFoodEntryOpen(true);
                }}
              >
                Add food entry
              </button>
            ) : null}
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
              onClick={onContinueFromFoodDiary}
              disabled={
                foodSaving || deletingFoodEntryId != null || foodEntriesLoading
              }
            >
              {foodEntries.length > 0 ? 'Continue' : 'Skip for now'}
            </button>
          </div>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
            onClick={() => {
              setCancelDialogOpen(true);
            }}
            disabled={cancelingEpisode}
          >
            Cancel episode
          </button>
        </div>
        <ConfirmDialog
          open={cancelDialogOpen}
          title="Cancel this active episode?"
          description="Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone."
          confirmLabel="Cancel episode"
          confirmBusyLabel="Canceling episode…"
          cancelLabel="Keep episode"
          onConfirm={onCancelEpisodeConfirm}
          onClose={() => {
            setCancelDialogOpen(false);
          }}
        />
      </>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-app-ink">
            Episode health markers
          </h1>
          <p className="mt-2 text-base font-medium text-app-muted">
            {lines.length === 0
              ? 'Next: episode details (after this screen)'
              : `Step ${activeIndex + 1} of ${lines.length}`}
          </p>
          {persistFeedback ? (
            <p
              className="mt-2 text-sm text-amber-800 dark:text-amber-200"
              role="status"
            >
              {persistFeedback.source === 'sync'
                ? `Could not sync with the server: ${persistFeedback.message}`
                : persistFeedback.message}
            </p>
          ) : null}
        </div>

        {lines.length === 0 ? (
          <div
            className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
            role="status"
          >
            <p className="text-sm leading-relaxed text-app-ink">
              This preset has no health marker lines to log—that is normal for
              some templates. Use Continue to episode details to add episode
              type, optional label, and notes.
            </p>
          </div>
        ) : currentLine ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-app-ink">
              {markerLineTitle(currentLine)}
            </h2>
            {currentLine.custom_unit ? (
              <p className="text-sm text-app-muted">
                Unit: {currentLine.custom_unit}
              </p>
            ) : null}
            {currentLine.marker_kind === 'blood_pressure' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-app-ink">
                  <span>Systolic</span>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    min={0}
                    value={currentDraft.systolic}
                    disabled={saving}
                    onChange={(e) => {
                      onUpdateDraft({ systolic: e.target.value });
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-app-ink">
                  <span>Diastolic</span>
                  <input
                    type="number"
                    step="any"
                    inputMode="decimal"
                    min={0}
                    value={currentDraft.diastolic}
                    disabled={saving}
                    onChange={(e) => {
                      onUpdateDraft({ diastolic: e.target.value });
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                  />
                </label>
              </div>
            ) : (
              <label className="space-y-1 text-sm font-medium text-app-ink">
                <span>
                  Value
                  {currentLine.marker_kind === 'bac'
                    ? ' (BAC)'
                    : currentLine.custom_unit
                      ? ` (${currentLine.custom_unit})`
                      : ''}
                </span>
                <input
                  type="number"
                  step="any"
                  inputMode="decimal"
                  min={minForPresetMarkerValueInput(currentLine.marker_kind)}
                  value={currentDraft.value}
                  disabled={saving}
                  onChange={(e) => {
                    onUpdateDraft({ value: e.target.value });
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                />
              </label>
            )}
            <label className="space-y-1 text-sm font-medium text-app-ink">
              <span>Notes (optional)</span>
              <textarea
                rows={3}
                value={currentDraft.notes}
                disabled={saving}
                onChange={(e) => {
                  onUpdateDraft({ notes: e.target.value });
                }}
                className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
              />
            </label>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={() => {
              if (activeIndex > 0) {
                goBackStep();
                return;
              }
              onBackToSymptomsFromHealthMarkers();
            }}
            disabled={saving}
          >
            Back
          </button>
          {currentLine ? (
            <button
              type="button"
              disabled={!canSkip || saving}
              className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
                skipPressable
                  ? 'hover:bg-app-surface/80'
                  : 'cursor-not-allowed opacity-50'
              }`}
              onClick={() => {
                void skipCurrent();
              }}
            >
              Skip marker
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl bg-red-700 px-4 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
            onClick={() => {
              void goNext();
            }}
            disabled={saving}
            aria-label={
              continueToFoodDiary
                ? 'Continue to food diary'
                : 'Next health marker'
            }
          >
            {saving
              ? 'Saving…'
              : continueToFoodDiary
                ? 'Continue to food diary'
                : 'Next'}
          </button>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
          onClick={() => {
            setCancelDialogOpen(true);
          }}
          disabled={cancelingEpisode}
        >
          Cancel episode
        </button>
      </div>
      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel this active episode?"
        description="Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone."
        confirmLabel="Cancel episode"
        confirmBusyLabel="Canceling episode…"
        cancelLabel="Keep episode"
        onConfirm={onCancelEpisodeConfirm}
        onClose={() => {
          setCancelDialogOpen(false);
        }}
      />
    </>
  );
}
