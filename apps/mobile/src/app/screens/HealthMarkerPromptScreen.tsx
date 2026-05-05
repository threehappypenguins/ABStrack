import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Alert,
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
  HealthMarkerRow,
  PresetHealthMarkerRow,
} from '@abstrack/types';
import {
  bacReadingSuggestsAbsEpisode,
  filterHealthMarkerRowsForOpenPass,
  findLatestHealthMarkerForLineInPass,
  formatEpisodeDurationSimple,
  PRESET_HEALTH_MARKER_KIND_LABELS,
  validatePresetHealthMarkerCustomFields,
} from '@abstrack/types';
import {
  getEpisodeById,
  listEpisodeObservationTimeline,
  listPresetHealthMarkersForPreset,
  type EpisodeTimelineItem,
  upsertEpisodeTimelineItem,
} from '@abstrack/supabase';
import { announce, COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { clearSymptomPromptSession } from '../../lib/episodes/symptom-prompt-session-store';
import {
  cancelActiveEpisodeByIdOfflineFirst,
  completeEpisodePostMarkerStepOfflineFirst,
  endEpisodeIfStillActiveOfflineFirst,
  insertEpisodeHealthMarkerLineOfflineFirst,
  listEpisodeHealthMarkersForEpisodeOfflineFirst,
} from '../../lib/episodes/mobile-offline-first-gateway';
import {
  getEpisodeByIdFromPowerSyncDb,
  listEpisodeHealthMarkersForEpisodeFromPowerSyncDb,
  listPresetHealthMarkersForPresetFromPowerSyncDb,
} from '../../lib/powersync/powersync-episode-flow-reads';
import {
  getPowerSyncDatabaseForOfflineReads,
  isPresetDataNetworkError,
} from '../../lib/powersync/powersync-offline-read-bridge-snapshot';
import {
  powerSyncReplicaSqliteReady,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../../lib/supabase-wiring';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { ScreenShell } from '../components/ScreenShell';
import { EpisodeFlowSecondaryActionsSection } from '../components/episode-flow/EpisodeFlowSecondaryActionsSection';
import type { MainStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';
import { HealthMarkerFoodDiaryStep } from './HealthMarkerFoodDiaryStep';
import { useHealthMarkerFoodDiary } from './use-health-marker-food-diary';

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

function formatTimelineInstant(isoLike: string): string {
  const ms = Date.parse(isoLike);
  if (!Number.isFinite(ms)) {
    return isoLike;
  }
  return new Date(ms).toLocaleString();
}

function healthMarkerDetailForTimeline(row: HealthMarkerRow): string {
  if (row.marker_kind === 'blood_pressure') {
    if (row.systolic_numeric != null && row.diastolic_numeric != null) {
      return `${row.systolic_numeric}/${row.diastolic_numeric}`;
    }
    return '—';
  }
  if (row.value_numeric != null) {
    let detail = String(row.value_numeric);
    if (row.custom_unit) {
      detail = `${detail} ${row.custom_unit}`;
    } else if (row.marker_kind === 'bac') {
      detail = `${detail} g/dL`;
    }
    return detail;
  }
  const n = row.notes?.trim();
  return n ? (n.length > 80 ? `${n.slice(0, 77)}…` : n) : '—';
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
  const { episodeId, resume = false, hub = false } = route.params;
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
  const [endingEpisode, setEndingEpisode] = useState(false);
  const [endFeedback, setEndFeedback] = useState<string | null>(null);
  const [endedSummary, setEndedSummary] = useState<{
    endedAt: string;
    durationText: string | null;
  } | null>(null);
  const postFormInitRef = useRef(false);
  const [cancelingEpisode, setCancelingEpisode] = useState(false);
  const [observationTimeline, setObservationTimeline] = useState<
    EpisodeTimelineItem[]
  >([]);

  const supabase = useMemo(() => getMobileSupabaseClient(), []);
  const psBridge = usePowerSyncBridgeState();
  const powerSyncDbForWrites = useMemo(
    () => (powerSyncReplicaSqliteReady(psBridge) ? psBridge.database : null),
    [psBridge],
  );
  /**
   * Latest write DB for offline-first calls inside `load` without listing `powerSyncDbForWrites` in
   * `load` deps — when first sync lands, the DB handle appears and would otherwise rerun the mount
   * effect and wipe phase/drafts/food-diary state mid-edit.
   */
  const powerSyncDbForWritesRef = useRef(powerSyncDbForWrites);
  powerSyncDbForWritesRef.current = powerSyncDbForWrites;

  /** Bumps when the screen unmounts or `load` deps change so stale async work does not setState. */
  const loadGenerationRef = useRef(0);

  const refreshObservationTimeline = useCallback(async () => {
    const tl = await listEpisodeObservationTimeline(supabase, episodeId);
    if (tl.ok) {
      setObservationTimeline(tl.data);
      return;
    }
    setObservationTimeline([]);
  }, [episodeId, supabase]);

  const onLeaveFoodDiary = useCallback(
    async (_decision: 'saved' | 'skipped') => {
      await refreshObservationTimeline();
      setPhase('postMarkers');
    },
    [refreshObservationTimeline],
  );

  const onBackToHealthMarkersFromFoodDiaryBody = useCallback(async () => {
    setPhase('prompting');
    await announce('Returned to health markers.', { politeness: 'polite' });
  }, []);

  const foodDiary = useHealthMarkerFoodDiary({
    episodeId,
    supabase,
    powerSyncDatabase: powerSyncDbForWrites,
    enabled: phase === 'foodDiary',
    onLeaveFoodDiary,
    onBack: onBackToHealthMarkersFromFoodDiaryBody,
  });
  const resetFoodDiaryState = foodDiary.reset;
  /** Lets `load` omit `resetFoodDiaryState` from deps so hook churn cannot rerun mount load. */
  const resetFoodDiaryStateRef = useRef(resetFoodDiaryState);
  resetFoodDiaryStateRef.current = resetFoodDiaryState;

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
    const generation = ++loadGenerationRef.current;
    const stale = () => generation !== loadGenerationRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistFeedback(null);
    setPhase('prompting');
    postFormInitRef.current = false;
    setPostFeedback(null);
    resetFoodDiaryStateRef.current();
    setEndFeedback(null);
    setEndedSummary(null);
    setObservationTimeline([]);

    let sessionUserId: string | null = null;
    const {
      data: { session },
      error: sessionError,
    } = await getMobileAuthSessionSafe();
    if (sessionError) {
      if (stale()) {
        return;
      }
      setErrorMessage(sessionError.message);
      setStatus('error');
      return;
    }
    sessionUserId = session?.user?.id ?? null;
    if (stale()) {
      return;
    }
    if (!sessionUserId) {
      setErrorMessage(
        'You must be signed in to save health marker answers. Try signing in again.',
      );
      setStatus('error');
      return;
    }
    setUserId(sessionUserId);

    const psDb = getPowerSyncDatabaseForOfflineReads();
    let usedPowerSyncReplicaReads = false;

    const episodeRemote = await getEpisodeById(supabase, episodeId);
    if (stale()) {
      return;
    }
    let episodeRow =
      episodeRemote.ok && episodeRemote.data ? episodeRemote.data : null;
    // Do not read SQLite on `ok` + null: authoritative not-found / RLS; replica could be stale online.
    const shouldTryEpisodeReplica =
      Boolean(psDb) &&
      !episodeRemote.ok &&
      isPresetDataNetworkError(episodeRemote.error);
    if (!episodeRow && shouldTryEpisodeReplica && psDb) {
      const localEp = await getEpisodeByIdFromPowerSyncDb(psDb, episodeId);
      if (localEp) {
        episodeRow = localEp;
        usedPowerSyncReplicaReads = true;
      }
    }
    if (!episodeRow) {
      if (!episodeRemote.ok) {
        setErrorMessage(episodeRemote.error.message);
      } else {
        setErrorMessage('Could not load this episode.');
      }
      setStatus('error');
      return;
    }
    const markerPresetId = episodeRow.health_marker_preset_id;
    if (!markerPresetId) {
      setErrorMessage(
        'This episode has no health marker preset linked. Return home and start a new episode template.',
      );
      setStatus('error');
      return;
    }
    setEpisodeRow(episodeRow);
    if (episodeRow.ended_at) {
      setEndedSummary({
        endedAt: episodeRow.ended_at,
        durationText: formatEpisodeDurationSimple(
          episodeRow.started_at,
          episodeRow.ended_at,
        ),
      });
    }

    let presetLines = await listPresetHealthMarkersForPreset(
      supabase,
      markerPresetId,
    );
    if (stale()) {
      return;
    }
    if (
      !presetLines.ok &&
      isPresetDataNetworkError(presetLines.error) &&
      psDb != null
    ) {
      presetLines = {
        ok: true,
        data: await listPresetHealthMarkersForPresetFromPowerSyncDb(
          psDb,
          markerPresetId,
        ),
      };
      usedPowerSyncReplicaReads = true;
    }
    if (!presetLines.ok) {
      setErrorMessage(presetLines.error.message);
      setStatus('error');
      return;
    }

    let markerRows = await listEpisodeHealthMarkersForEpisodeOfflineFirst(
      supabase,
      powerSyncDbForWritesRef.current,
      episodeId,
    );
    if (stale()) {
      return;
    }
    if (
      !markerRows.ok &&
      isPresetDataNetworkError(markerRows.error) &&
      psDb != null
    ) {
      markerRows = {
        ok: true,
        data: await listEpisodeHealthMarkersForEpisodeFromPowerSyncDb(
          psDb,
          episodeId,
        ),
        markersReadFromLocalReplica: true,
      };
      usedPowerSyncReplicaReads = true;
    }
    if (!markerRows.ok) {
      setErrorMessage(markerRows.error.message);
      setStatus('error');
      return;
    }
    if (markerRows.markersReadFromLocalReplica) {
      usedPowerSyncReplicaReads = true;
    }

    setLines(presetLines.data);

    const lastPost: string | null =
      episodeRow.post_marker_step_completed_at ?? null;
    const passRows = filterHealthMarkerRowsForOpenPass(
      markerRows.data,
      lastPost,
    );
    const nextDrafts: Record<string, MarkerDraft> = {};
    let firstUnanswered = -1;
    for (const [idx, line] of presetLines.data.entries()) {
      const marker = findLatestHealthMarkerForLineInPass(passRows, line);
      nextDrafts[line.id] = createDraftFromMarker(marker);
      if (firstUnanswered === -1 && marker == null) {
        firstUnanswered = idx;
      }
    }
    setDrafts(nextDrafts);

    // Initial hydrate / resume; values logged later in this session are picked up in
    // enterFoodDiaryPhaseAfterMarkers before the post-marker step.
    setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));

    if (resume && hub && lastPost != null) {
      setPhase('complete');
    } else if (resume && firstUnanswered === -1) {
      setPhase('foodDiary');
    } else if (resume && firstUnanswered >= 0) {
      setActiveIndex(firstUnanswered);
    } else {
      setActiveIndex(0);
    }
    setStatus('ready');

    if (usedPowerSyncReplicaReads) {
      setObservationTimeline([]);
    } else {
      const tl = await listEpisodeObservationTimeline(supabase, episodeId, {
        prefetchedHealthMarkers: markerRows.data,
      });
      if (stale()) {
        return;
      }
      if (tl.ok) {
        setObservationTimeline(tl.data);
      } else {
        setObservationTimeline([]);
      }
    }
  }, [episodeId, hub, resume, supabase]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    let cancelled = false;
    void loadRef.current().catch((error: unknown) => {
      if (cancelled) {
        return;
      }
      console.error(
        'HealthMarkerPromptScreen load() rejected unexpectedly',
        error,
      );
      setStatus('error');
      setErrorMessage('Unable to load this screen. Please try again.');
    });
    return () => {
      cancelled = true;
      loadGenerationRef.current += 1;
    };
  }, [episodeId, hub, resume]);

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
    const result = await insertEpisodeHealthMarkerLineOfflineFirst(
      supabase,
      powerSyncDbForWrites,
      {
        userId,
        episodeId,
        line: currentLine,
        valueNumeric: parsed.valueNumeric,
        systolicNumeric: parsed.systolicNumeric,
        diastolicNumeric: parsed.diastolicNumeric,
        notes: currentDraft.notes.trim() ? currentDraft.notes.trim() : null,
      },
    );
    setSaving(false);
    if (!result.ok) {
      setPersistFeedback({ source: 'sync', message: result.error.message });
      await announce(
        `Could not save this measurement. ${result.error.message}`,
        {
          politeness: 'assertive',
        },
      );
      return false;
    }
    const timelineItem: EpisodeTimelineItem = {
      kind: 'health_marker',
      sortAt: result.data.recorded_at,
      id: result.data.id,
      label: markerLineTitle(currentLine),
      detail: healthMarkerDetailForTimeline(result.data),
    };
    setObservationTimeline((prev) =>
      upsertEpisodeTimelineItem(prev, timelineItem),
    );
    return true;
  };

  /**
   * Re-reads saved episode markers so BAC suggestion reflects values logged during this session,
   * then moves to the food diary step.
   */
  const enterFoodDiaryPhaseAfterMarkers = useCallback(async () => {
    const markerRows = await listEpisodeHealthMarkersForEpisodeOfflineFirst(
      supabase,
      powerSyncDbForWrites,
      episodeId,
    );
    if (markerRows.ok) {
      setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));
    }
    setPhase('foodDiary');
  }, [episodeId, powerSyncDbForWrites, supabase]);

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
    const result = await completeEpisodePostMarkerStepOfflineFirst(
      supabase,
      powerSyncDbForWrites,
      episodeId,
      {
        episode_type: postEpisodeKind,
        episode_label: trimToNull(postLabel),
        additional_notes: trimToNull(postAdditional),
        note: trimToNull(postNote),
        // Completion signal only: DB overwrites stored boundary with authoritative server time.
        post_marker_step_completed_at: null,
      },
    );
    setSavingPost(false);
    if (!result.ok) {
      setPostFeedback(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    setEpisodeRow(result.data);
    setEndFeedback(null);
    setEndedSummary(null);
    await refreshObservationTimeline();
    setPhase('complete');
    await announce(
      result.data.symptom_preset_id
        ? 'This check-in is saved. You can log another when you are ready, or return home.'
        : 'Episode details saved.',
      { politeness: 'polite' },
    );
  };

  const onLogAnotherCheckIn = useCallback(() => {
    const presetId = episodeRow?.symptom_preset_id;
    if (!presetId) {
      void announce(
        'This episode has no symptom preset linked, so another check-in cannot start here.',
        { politeness: 'assertive' },
      );
      return;
    }
    clearSymptomPromptSession(episodeId);
    void announce('Opening symptoms for another check-in.', {
      politeness: 'polite',
    });
    navigation.replace('SymptomPrompt', {
      episodeId,
      symptomPresetId: presetId,
      resume: true,
    });
  }, [episodeId, episodeRow?.symptom_preset_id, navigation]);

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
                const result = await cancelActiveEpisodeByIdOfflineFirst(
                  supabase,
                  powerSyncDbForWrites,
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
      const result = await endEpisodeIfStillActiveOfflineFirst(
        supabase,
        powerSyncDbForWrites,
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
      if (powerSyncDbForWrites) {
        const local = await getEpisodeByIdFromPowerSyncDb(
          powerSyncDbForWrites,
          episodeId,
        );
        if (local?.ended_at) {
          const durationText = formatEpisodeDurationSimple(
            local.started_at,
            local.ended_at,
          );
          setEpisodeRow(local);
          setEndedSummary({ endedAt: local.ended_at, durationText });
          await announce('This episode was already ended.', {
            politeness: 'polite',
          });
          return;
        }
      }
      const message =
        'This episode is no longer active. Return home and refresh episodes.';
      setEndFeedback(message);
      await announce(message, { politeness: 'assertive' });
    } finally {
      setEndingEpisode(false);
    }
  }, [endingEpisode, episodeId, episodeRow, powerSyncDbForWrites, supabase]);

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
              : phase === 'complete' && !endedSummary
                ? 'This check-in is saved'
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
          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            contentContainerStyle={{ paddingBottom: 24 }}
          >
            <View className="gap-4" accessibilityLiveRegion="polite">
              {observationTimeline.length > 0 && !endedSummary ? (
                <View
                  className={`rounded-2xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-bg-dark`}
                  accessibilityLabel="Recent log entries in this episode"
                >
                  <Text
                    className={`text-sm font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Recent log entries in this episode
                  </Text>
                  <Text
                    className={`mt-1 text-xs ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Showing recent entries only. Oldest first within this slice.
                  </Text>
                  {observationTimeline.map((row) => (
                    <Text
                      key={`${row.kind}-${row.id}`}
                      className={`mt-2 text-sm ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {formatTimelineInstant(row.sortAt)}
                      {' — '}
                      {row.label}: {row.detail}
                    </Text>
                  ))}
                </View>
              ) : null}
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
                <View className="gap-3">
                  <Text
                    className={`text-base leading-relaxed ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    This round is saved: symptoms, health markers, any food
                    diary entries you added, and episode details.
                  </Text>
                  <Text
                    className={`text-sm leading-relaxed ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Return home, log another full check-in when you are ready,
                    or end this episode when you are completely done.
                  </Text>
                </View>
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
                <View className="gap-3">
                  {episodeRow?.symptom_preset_id ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Log another check-in"
                      onPress={onLogAnotherCheckIn}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className="items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 dark:bg-red-600"
                    >
                      <Text className="text-center text-[17px] font-semibold text-white">
                        Log another check-in
                      </Text>
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Return to home"
                    onPress={onFinishToHome}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-4 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark"
                  >
                    <Text
                      className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    >
                      Return home
                    </Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      endingEpisode ? 'Ending episode' : 'End episode'
                    }
                    accessibilityState={{ disabled: endingEpisode }}
                    disabled={endingEpisode}
                    onPress={onRequestEndEpisode}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-4 py-4 active:opacity-90 disabled:opacity-60 dark:border-app-border-dark dark:bg-app-bg-dark"
                  >
                    <Text
                      className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    >
                      {endingEpisode ? 'Ending episode…' : 'End episode'}
                    </Text>
                  </Pressable>
                </View>
              )}
            </View>
          </ScrollView>
        ) : phase === 'foodDiary' ? (
          <HealthMarkerFoodDiaryStep
            fd={foodDiary}
            colors={colors}
            onCancelEpisodePress={onCancelEpisodePress}
          />
        ) : phase === 'postMarkers' ? (
          <ScrollView
            className="flex-1"
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator
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
                Suggested as ABS because a BAC value above zero was logged. You
                can change this.
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
            <EpisodeFlowSecondaryActionsSection>
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
            </EpisodeFlowSecondaryActionsSection>
          </ScrollView>
        ) : (
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
              showsVerticalScrollIndicator
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
              {observationTimeline.length > 0 ? (
                <View
                  accessibilityLabel="Recent log entries in this episode, oldest first within this slice"
                  className="mt-6 rounded-xl border border-app-border bg-app-surface p-4 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-sm font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Recent log entries in this episode
                  </Text>
                  <Text
                    className={`mb-2 text-xs ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Showing recent entries only. Oldest first within this slice.
                  </Text>
                  {observationTimeline.map((row) => (
                    <Text
                      key={`${row.kind}-${row.id}`}
                      className={`mb-2 text-sm ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {formatTimelineInstant(row.sortAt)} — {row.label}:{' '}
                      {row.detail}
                    </Text>
                  ))}
                </View>
              ) : null}
              <EpisodeFlowSecondaryActionsSection>
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
              </EpisodeFlowSecondaryActionsSection>
            </ScrollView>
          </AsyncScreenContainer>
        )}
      </View>
    </ScreenShell>
  );
}
