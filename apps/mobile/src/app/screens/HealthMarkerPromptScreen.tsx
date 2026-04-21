import React, { useEffect, useMemo, useState } from 'react';
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
import type { HealthMarkerRow, PresetHealthMarkerRow } from '@abstrack/types';
import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  validatePresetHealthMarkerCustomFields,
} from '@abstrack/types';
import {
  cancelActiveEpisodeById,
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
  const lineCustomName = normalizeNullable(line.custom_name);
  const lineCustomUnit = normalizeNullable(line.custom_unit);
  return (
    rows.find((row) => {
      return (
        row.marker_kind === line.marker_kind &&
        normalizeNullable(row.custom_name) === lineCustomName &&
        normalizeNullable(row.custom_unit) === lineCustomUnit
      );
    }) ?? null
  );
}

function draftHasValue(
  line: PresetHealthMarkerRow,
  draft: MarkerDraft,
): boolean {
  if (line.marker_kind === 'blood_pressure') {
    return (
      draft.systolic.trim().length > 0 || draft.diastolic.trim().length > 0
    );
  }
  return draft.value.trim().length > 0;
}

function parseOptionalNumber(raw: string): number | null {
  const trimmed = raw.trim();
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
  const [phase, setPhase] = useState<'prompting' | 'complete'>('prompting');
  const [userId, setUserId] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MarkerDraft>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [cancelingEpisode, setCancelingEpisode] = useState(false);

  const supabase = useMemo(() => getMobileSupabaseClient(), []);

  const load = async () => {
    setStatus('loading');
    setErrorMessage(null);
    setPersistFeedback(null);
    setPhase('prompting');

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setErrorMessage(
        'You must be signed in to save health marker answers. Try signing in again.',
      );
      setStatus('error');
      return;
    }
    setUserId(user.id);

    const episode = await getEpisodeById(supabase, episodeId);
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

    const [presetLines, markerRows] = await Promise.all([
      listPresetHealthMarkersForPreset(supabase, markerPresetId),
      listEpisodeHealthMarkersForEpisode(supabase, episodeId),
    ]);
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

    const firstUnanswered = presetLines.data.findIndex((line) => {
      const row = findExistingMarkerForLine(markerRows.data, line);
      return row === null;
    });
    if (resume && firstUnanswered === -1) {
      setPhase('complete');
    } else if (resume && firstUnanswered >= 0) {
      setActiveIndex(firstUnanswered);
    } else {
      setActiveIndex(0);
    }
    setStatus('ready');
  };

  useEffect(() => {
    void load();
  }, [episodeId, resume]);

  const currentLine = lines[activeIndex] ?? null;
  const currentDraft = currentLine
    ? (drafts[currentLine.id] ?? createDraftFromMarker(null))
    : createDraftFromMarker(null);
  const currentAnswered = currentLine
    ? draftHasValue(currentLine, currentDraft)
    : true;
  const canSkip = Boolean(currentLine) && !currentAnswered;

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

    const value = parseOptionalNumber(currentDraft.value);
    const systolic = parseOptionalNumber(currentDraft.systolic);
    const diastolic = parseOptionalNumber(currentDraft.diastolic);

    if (currentLine.marker_kind === 'blood_pressure') {
      if (systolic == null || diastolic == null) {
        const message =
          'Enter both systolic and diastolic blood pressure values to continue.';
        setPersistFeedback({
          source: 'validation',
          message,
        });
        await announce(message, { politeness: 'assertive' });
        return false;
      }
      if (Number.isNaN(systolic) || Number.isNaN(diastolic)) {
        const message =
          'Blood pressure values must be valid numbers (for example 120 and 80).';
        setPersistFeedback({
          source: 'validation',
          message,
        });
        await announce(message, { politeness: 'assertive' });
        return false;
      }
    } else {
      if (value == null) {
        const message = 'Enter a numeric value to continue.';
        setPersistFeedback({
          source: 'validation',
          message,
        });
        await announce(message, { politeness: 'assertive' });
        return false;
      }
      if (Number.isNaN(value)) {
        const message = 'Value must be a valid number.';
        setPersistFeedback({
          source: 'validation',
          message,
        });
        await announce(message, { politeness: 'assertive' });
        return false;
      }
    }

    setSaving(true);
    setPersistFeedback(null);
    const result = await upsertEpisodeHealthMarkerForLine(supabase, {
      userId,
      episodeId,
      line: currentLine,
      valueNumeric:
        currentLine.marker_kind === 'blood_pressure' ? null : (value ?? null),
      systolicNumeric:
        currentLine.marker_kind === 'blood_pressure'
          ? (systolic ?? null)
          : null,
      diastolicNumeric:
        currentLine.marker_kind === 'blood_pressure'
          ? (diastolic ?? null)
          : null,
      notes: currentDraft.notes.trim() ? currentDraft.notes.trim() : null,
    });
    setSaving(false);
    if (!result.ok) {
      setPersistFeedback({ source: 'sync', message: result.error.message });
      return false;
    }
    return true;
  };

  const goNext = async () => {
    if (saving) {
      return;
    }
    if (!currentLine) {
      setPhase('complete');
      return;
    }
    const saved = await saveCurrentLine();
    if (!saved) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      setPhase('complete');
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
      setPhase('complete');
      await announce('Health marker list complete.', { politeness: 'polite' });
      return;
    }
    setActiveIndex((prev) => prev + 1);
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
          Episode health markers
        </Text>
        {persistFeedback ? (
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
              You reached the end of your health marker list for this episode.
              You can return home when you are ready.
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
                        canSkip ? 'active:opacity-90' : 'opacity-50'
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
                      lines.length > 0 && activeIndex >= lines.length - 1
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
