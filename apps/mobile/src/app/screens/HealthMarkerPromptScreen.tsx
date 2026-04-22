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
  PRESET_HEALTH_MARKER_KIND_LABELS,
  validatePresetHealthMarkerCustomFields,
} from '@abstrack/types';
import {
  cancelActiveEpisodeById,
  completeEpisodePostMarkerStep,
  getEpisodeById,
  listEpisodeHealthMarkersForEpisode,
  listPresetHealthMarkersForPreset,
  upsertEpisodeHealthMarkerForLine,
} from '@abstrack/supabase';
import { announce, COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
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
  const [phase, setPhase] = useState<'prompting' | 'postMarkers' | 'complete'>(
    'prompting',
  );
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
    // enterPostMarkerPhaseAfterMarkers before the post-marker step.
    setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));

    const firstUnanswered = presetLines.data.findIndex((line) => {
      const row = findExistingMarkerForLine(markerRows.data, line);
      return row === null;
    });
    if (resume && firstUnanswered === -1) {
      if (episode.data?.post_marker_step_completed_at) {
        setPhase('complete');
      } else {
        setPhase('postMarkers');
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
   * then moves to the post–marker episode details step.
   */
  const enterPostMarkerPhaseAfterMarkers = useCallback(async () => {
    const markerRows = await listEpisodeHealthMarkersForEpisode(
      supabase,
      episodeId,
    );
    if (markerRows.ok) {
      setBacSuggestAbs(bacReadingSuggestsAbsEpisode(markerRows.data));
    }
    setPhase('postMarkers');
  }, [episodeId, supabase]);

  const goNext = async () => {
    if (saving) {
      return;
    }
    if (!currentLine) {
      await enterPostMarkerPhaseAfterMarkers();
      await announce('Health marker list complete.', { politeness: 'polite' });
      return;
    }
    const saved = await saveCurrentLine();
    if (!saved) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      await enterPostMarkerPhaseAfterMarkers();
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
      await enterPostMarkerPhaseAfterMarkers();
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
    setPhase('complete');
    await announce('Episode details saved.', { politeness: 'polite' });
  };

  const onFinishToHome = () => {
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
    );
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
            <Text
              className={`text-base leading-relaxed ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Preset prompts and episode details for this episode are saved. You
              can return home when you are ready.
            </Text>
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
          </View>
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
                Choose ABS or Other; other fields are optional.
              </Text>
              <Text
                accessibilityRole="header"
                className={`mb-2 text-lg font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Episode type
              </Text>
              <View className="mb-4 gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="ABS episode type"
                  accessibilityState={{ selected: postEpisodeKind === 'ABS' }}
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
                  accessibilityRole="button"
                  accessibilityLabel="Other episode type"
                  accessibilityState={{ selected: postEpisodeKind === 'Other' }}
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
                  Step {activeIndex + 1} of {Math.max(lines.length, 1)}
                </Text>

                {lines.length === 0 ? (
                  <Text
                    className={`text-base leading-relaxed ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    This episode&apos;s marker preset has no lines. You can
                    return home.
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
                  {activeIndex > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Previous marker"
                      onPress={goBackStep}
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
                  ) : null}
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
                      lines.length === 0
                        ? 'Done'
                        : activeIndex >= lines.length - 1
                          ? 'Finish health marker list'
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
                        : lines.length === 0
                          ? 'Done'
                          : activeIndex >= lines.length - 1
                            ? 'Finish'
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
