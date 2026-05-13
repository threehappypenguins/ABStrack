import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useNavigation } from '@react-navigation/native';
import type {
  HealthMarkerPresetRow,
  PresetHealthMarkerRow,
} from '@abstrack/types';
import {
  createDraftFromMarker,
  markerLineTitle,
  parseMeasurementDraftForSave,
  validatePresetHealthMarkerCustomFields,
  type MarkerDraft,
} from '@abstrack/types';
import {
  createStandaloneHealthMarkerForLine,
  listHealthMarkerPresets,
  listPresetHealthMarkersForPreset,
} from '@abstrack/supabase';
import { announce } from '@abstrack/ui/native';
import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../../lib/supabase-wiring';
import { useMobilePhiSubjectUserContext } from '../../lib/auth/use-mobile-phi-subject-user-context';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { nw } from '../theme/app-nativewind-classes';

type StandaloneHealthMarkersNav = NativeStackNavigationProp<
  MainStackParamList,
  'StandaloneHealthMarkers'
>;

/**
 * Standalone health-marker logging (no episode), matching web `/health-markers/new`.
 *
 * @returns Preset picker, line-by-line prompts, and completion UI.
 */
export function StandaloneHealthMarkersScreen() {
  const navigation = useNavigation<StandaloneHealthMarkersNav>();
  const supabase = useMemo(() => getMobileSupabaseClient(), []);
  const {
    phiSubjectUserId,
    loading: phiScopeLoading,
    errorMessage: phiScopeError,
  } = useMobilePhiSubjectUserContext();

  const [authLoading, setAuthLoading] = useState(true);
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  /**
   * Session read/recovery failed (e.g. SecureStore). Kept separate from preset `loadError` so the
   * presets effect does not clear it when `authUserId` is still null.
   */
  const [authSessionError, setAuthSessionError] = useState<string | null>(null);
  const [authRetryTick, setAuthRetryTick] = useState(0);

  const [phase, setPhase] = useState<'pickPreset' | 'prompting' | 'complete'>(
    'pickPreset',
  );
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [presets, setPresets] = useState<HealthMarkerPresetRow[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, MarkerDraft>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  /** Lines successfully persisted via Next/Finish in the current preset session. */
  const [linesSavedCount, setLinesSavedCount] = useState(0);
  const [presetRefetchTick, setPresetRefetchTick] = useState(0);
  /**
   * Last scope key `authUserId|phiSubjectUserId` for preset loads. When either changes (caretaker
   * patient link, first sync, etc.), we reset pick-preset / line UI so lists match the active PHI subject.
   */
  const lastPresetScopeKeyRef = useRef<string | null>(null);
  const authSnapshotGenerationRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const runGeneration = ++authSnapshotGenerationRef.current;
    void (async () => {
      setAuthLoading(true);
      try {
        const { data, error } = await getMobileAuthSessionSafe();
        if (cancelled || authSnapshotGenerationRef.current !== runGeneration) {
          return;
        }
        if (error) {
          setAuthUserId(null);
          setAuthSessionError(
            error.message || 'Unable to read your sign-in session.',
          );
          return;
        }
        setAuthSessionError(null);
        setAuthUserId(data.session?.user?.id ?? null);
      } finally {
        if (!cancelled && authSnapshotGenerationRef.current === runGeneration) {
          setAuthLoading(false);
        }
      }
    })();
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      authSnapshotGenerationRef.current += 1;
      // Invalidate in-flight getMobileAuthSessionSafe completions (see runGeneration above).
      if (cancelled) {
        return;
      }
      const uid = session?.user?.id ?? null;
      setAuthUserId(uid);
      setAuthSessionError(null);
      setAuthLoading(false);
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, [supabase, authRetryTick]);

  useEffect(() => {
    if (authLoading || phiScopeLoading) {
      return;
    }

    const userId = authUserId;
    if (phiScopeError || !userId) {
      lastPresetScopeKeyRef.current = null;
      setPresets([]);
      setLoadError(null);
      setLoadingPresets(false);
      setPhase('pickPreset');
      setLines([]);
      setDrafts({});
      setActiveIndex(0);
      setSelectedPresetId(null);
      setFeedback(null);
      setLinesSavedCount(0);
      return;
    }

    const scopeKey = `${userId}|${phiSubjectUserId ?? ''}`;
    const switchedScope =
      lastPresetScopeKeyRef.current !== null &&
      lastPresetScopeKeyRef.current !== scopeKey;
    lastPresetScopeKeyRef.current = scopeKey;

    if (switchedScope) {
      setPhase('pickPreset');
      setLines([]);
      setDrafts({});
      setActiveIndex(0);
      setSelectedPresetId(null);
      setFeedback(null);
      setLinesSavedCount(0);
    }

    let cancelled = false;
    setLoadingPresets(true);
    setLoadError(null);

    void (async () => {
      const result = await listHealthMarkerPresets(supabase);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.error.message);
        setLoadingPresets(false);
        return;
      }
      setPresets(result.data);
      setLoadingPresets(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [
    authLoading,
    phiScopeLoading,
    phiScopeError,
    authUserId,
    phiSubjectUserId,
    supabase,
    presetRefetchTick,
  ]);

  useEffect(() => {
    setFeedback(null);
  }, [activeIndex]);

  const goHome = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'Home' });
  }, [navigation]);

  const openHealthMarkerPresetsTab = useCallback(() => {
    navigation.navigate('MainTabs', { screen: 'HealthMarkerPresets' });
  }, [navigation]);

  const currentLine = lines[activeIndex] ?? null;
  const currentLineId = currentLine?.id;
  const currentDraft = currentLine
    ? (drafts[currentLine.id] ?? createDraftFromMarker(null))
    : createDraftFromMarker(null);
  const measurementUnsavable = currentLine
    ? !parseMeasurementDraftForSave(currentLine, currentDraft).ok
    : true;
  const lineConfigBlocksSave = currentLine
    ? validatePresetHealthMarkerCustomFields(
        currentLine.marker_kind,
        currentLine.custom_name ?? '',
        currentLine.custom_unit ?? '',
      ) != null
    : false;
  const canSkip = currentLine
    ? measurementUnsavable || lineConfigBlocksSave
    : false;

  const patchCurrentLineDraft = useCallback(
    (patch: Partial<MarkerDraft>) => {
      if (!currentLineId) {
        return;
      }
      const id = currentLineId;
      setDrafts((prev) => {
        const base = prev[id] ?? createDraftFromMarker(null);
        return { ...prev, [id]: { ...base, ...patch } };
      });
    },
    [currentLineId],
  );

  const startPresetFlow = async () => {
    if (!selectedPresetId || saving) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    const result = await listPresetHealthMarkersForPreset(
      supabase,
      selectedPresetId,
    );
    setSaving(false);
    if (!result.ok) {
      setFeedback(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    if (result.data.length === 0) {
      const message =
        'This preset has no marker lines to log yet. Add markers under the Markers tab (health marker presets), or choose a different preset.';
      setFeedback(message);
      await announce(message, { politeness: 'polite' });
      return;
    }
    const nextDrafts: Record<string, MarkerDraft> = {};
    for (const line of result.data) {
      nextDrafts[line.id] = createDraftFromMarker(null);
    }
    setDrafts(nextDrafts);
    setLines(result.data);
    setActiveIndex(0);
    setLinesSavedCount(0);
    setPhase('prompting');
    await announce('Health marker logging started.', { politeness: 'polite' });
  };

  const saveCurrentLine = async (): Promise<boolean> => {
    if (!currentLine || !phiSubjectUserId) {
      return false;
    }
    const customValidation = validatePresetHealthMarkerCustomFields(
      currentLine.marker_kind,
      currentLine.custom_name ?? '',
      currentLine.custom_unit ?? '',
    );
    if (customValidation) {
      setFeedback(customValidation);
      await announce(customValidation, { politeness: 'assertive' });
      return false;
    }
    const parsed = parseMeasurementDraftForSave(currentLine, currentDraft);
    if (!parsed.ok) {
      setFeedback(parsed.message);
      await announce(parsed.message, { politeness: 'assertive' });
      return false;
    }
    setSaving(true);
    setFeedback(null);
    const result = await createStandaloneHealthMarkerForLine(supabase, {
      userId: phiSubjectUserId,
      line: currentLine,
      valueNumeric: parsed.valueNumeric,
      systolicNumeric: parsed.systolicNumeric,
      diastolicNumeric: parsed.diastolicNumeric,
      notes: currentDraft.notes.trim() ? currentDraft.notes.trim() : null,
    });
    setSaving(false);
    if (!result.ok) {
      setFeedback(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return false;
    }
    return true;
  };

  const onNext = async () => {
    if (saving || !currentLine) {
      return;
    }
    const saved = await saveCurrentLine();
    if (!saved) {
      return;
    }
    const nextCount = linesSavedCount + 1;
    setLinesSavedCount(nextCount);
    if (activeIndex >= lines.length - 1) {
      setFeedback(null);
      setPhase('complete');
      if (nextCount === lines.length) {
        await announce('Standalone health markers saved.', {
          politeness: 'polite',
        });
      } else {
        await announce(
          `Saved ${nextCount} of ${lines.length} marker lines. Skipped lines were not saved.`,
          { politeness: 'polite' },
        );
      }
      return;
    }
    setActiveIndex((prev) => prev + 1);
  };

  const primaryBtn = 'min-h-[56px] items-center justify-center rounded-xl px-4';
  const secondaryBtn =
    'min-h-[56px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 dark:border-app-border-dark dark:bg-app-surface-dark';

  if (authLoading || phiScopeLoading) {
    return (
      <ScreenShell>
        <View className="min-h-[120px] items-center justify-center py-8">
          <ActivityIndicator size="large" />
          <Text className={`mt-3 text-center text-sm ${nw.textMuted}`}>
            Loading…
          </Text>
        </View>
      </ScreenShell>
    );
  }

  if (authSessionError) {
    const secondaryBtn =
      'min-h-[56px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 dark:border-app-border-dark dark:bg-app-surface-dark';
    return (
      <ScreenShell contentAlign="stretch">
        <Text
          className={`text-xl font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Log health markers
        </Text>
        <Text
          accessibilityRole="alert"
          className={`mt-4 text-sm ${nw.textError}`}
        >
          {authSessionError}
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Try checking sign-in again"
          onPress={() => {
            setAuthRetryTick((n) => n + 1);
          }}
          className={`mt-6 ${secondaryBtn}`}
        >
          <Text
            className={`text-center text-base font-semibold ${nw.textPrimary}`}
          >
            Try again
          </Text>
        </Pressable>
      </ScreenShell>
    );
  }

  if (phiScopeError) {
    return (
      <ScreenShell>
        <Text
          className={`text-xl font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Log health markers
        </Text>
        <Text
          className={`mt-2 text-sm ${nw.textMuted}`}
          accessibilityRole="alert"
        >
          {phiScopeError}
        </Text>
      </ScreenShell>
    );
  }

  if (authUserId && !phiSubjectUserId) {
    return (
      <ScreenShell>
        <View className="min-h-[120px] items-center justify-center py-8">
          <ActivityIndicator size="large" />
          <Text className={`mt-3 text-center text-sm ${nw.textMuted}`}>
            Preparing your account…
          </Text>
        </View>
      </ScreenShell>
    );
  }

  if (!authUserId) {
    return (
      <ScreenShell>
        <Text
          className={`text-xl font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Log health markers
        </Text>
        <Text className={`mt-2 text-sm ${nw.textMuted}`}>
          You need to be signed in.
        </Text>
      </ScreenShell>
    );
  }

  if (loadingPresets) {
    return (
      <ScreenShell>
        <View className="min-h-[120px] items-center justify-center py-8">
          <ActivityIndicator size="large" />
          <Text className={`mt-3 text-center text-sm ${nw.textMuted}`}>
            Loading presets…
          </Text>
        </View>
      </ScreenShell>
    );
  }

  if (phase === 'complete') {
    const saved = linesSavedCount;
    const total = lines.length;
    const allLinesSaved = total > 0 && saved === total;
    const noneSaved = saved === 0;
    return (
      <ScreenShell contentAlign="stretch">
        <ScrollView keyboardShouldPersistTaps="handled" className="flex-1">
          <Text
            className={`text-xl font-semibold ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            {noneSaved
              ? 'Logging finished'
              : allLinesSaved
                ? 'Health markers saved'
                : 'Health markers partially saved'}
          </Text>
          <Text
            accessibilityLiveRegion="polite"
            accessibilityRole="text"
            className={`mt-2 text-sm ${nw.textMuted}`}
          >
            {noneSaved
              ? 'No health marker entries were saved. You can go back to home or start again from Log health markers when you are ready.'
              : allLinesSaved
                ? 'Your marker entries were saved.'
                : `You saved ${saved} of ${total} marker line${total === 1 ? '' : 's'}. Skipped lines were not recorded.`}
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Back to home"
            onPress={goHome}
            className={`mt-6 ${primaryBtn} ${nw.btnPrimary}`}
          >
            <Text
              className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
            >
              Back to home
            </Text>
          </Pressable>
        </ScrollView>
      </ScreenShell>
    );
  }

  if (phase === 'pickPreset') {
    return (
      <ScreenShell contentAlign="stretch">
        <ScrollView keyboardShouldPersistTaps="handled" className="flex-1">
          <Text
            className={`text-xl font-semibold ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Log health markers
          </Text>
          <Text className={`mt-2 text-sm ${nw.textMuted}`}>
            Choose a health marker preset to log vitals without starting an
            episode.
          </Text>

          {loadError ? (
            <View className="mt-4 gap-3">
              <Text
                accessibilityRole="alert"
                className={`text-sm ${nw.textError}`}
              >
                {loadError}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Try loading presets again"
                onPress={() => {
                  setPresetRefetchTick((n) => n + 1);
                }}
                className={secondaryBtn}
              >
                <Text
                  className={`text-center text-sm font-semibold ${nw.textPrimary}`}
                >
                  Try again
                </Text>
              </Pressable>
            </View>
          ) : null}

          {!loadError && presets.length === 0 ? (
            <View
              className={`mt-4 rounded-xl border border-app-border p-4 dark:border-app-border-dark`}
            >
              <Text className={`text-sm leading-relaxed ${nw.textInk}`}>
                You do not have any health marker presets yet. Create one under
                the Markers tab.
              </Text>
            </View>
          ) : !loadError && presets.length > 0 ? (
            <View className="mt-4 gap-2" accessibilityRole="radiogroup">
              <Text className={`text-base font-semibold ${nw.textInk}`}>
                Choose one preset
              </Text>
              {presets.map((preset) => {
                const selected = selectedPresetId === preset.id;
                return (
                  <Pressable
                    key={preset.id}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    onPress={() => {
                      setSelectedPresetId(preset.id);
                      setFeedback(null);
                    }}
                    className={`min-h-[56px] flex-row items-center gap-3 rounded-xl border px-4 py-3 ${
                      selected
                        ? 'border-red-700 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                        : `border-app-border bg-app-surface dark:border-app-border-dark dark:bg-app-surface-dark`
                    }`}
                  >
                    <View
                      className={`h-5 w-5 rounded-full border-2 ${
                        selected
                          ? 'border-red-700 bg-red-700 dark:border-red-500 dark:bg-red-500'
                          : 'border-app-border dark:border-app-border-dark'
                      }`}
                    />
                    <Text
                      className={`flex-1 text-base font-medium ${nw.textInk}`}
                    >
                      {preset.name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {feedback ? (
            <Text
              accessibilityRole="alert"
              className={`mt-4 text-sm ${nw.textError}`}
            >
              {feedback}
            </Text>
          ) : null}

          {!loadError && presets.length > 0 ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                saving ? 'Loading preset lines' : 'Start logging markers'
              }
              disabled={!selectedPresetId || saving}
              onPress={() => {
                void startPresetFlow();
              }}
              className={`mt-6 ${primaryBtn} ${!selectedPresetId || saving ? 'opacity-50' : ''} ${nw.btnPrimary}`}
            >
              <Text
                className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
              >
                {saving ? 'Loading…' : 'Start logging'}
              </Text>
            </Pressable>
          ) : null}
        </ScrollView>
      </ScreenShell>
    );
  }

  if (lines.length === 0) {
    return (
      <ScreenShell contentAlign="stretch">
        <ScrollView keyboardShouldPersistTaps="handled" className="flex-1">
          <Text
            className={`text-xl font-semibold ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Standalone health markers
          </Text>
          <Text
            accessibilityRole="text"
            className={`mt-2 text-sm ${nw.textMuted}`}
          >
            This preset has no marker lines to log. Nothing was saved.
          </Text>
          <View className="mt-4 gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Choose another preset"
              onPress={async () => {
                setPhase('pickPreset');
                setLines([]);
                setDrafts({});
                setActiveIndex(0);
                setFeedback(null);
                setSelectedPresetId(null);
                setLinesSavedCount(0);
                await announce('Choose a health marker preset.', {
                  politeness: 'polite',
                });
              }}
              className={secondaryBtn}
            >
              <Text
                className={`text-center text-base font-semibold ${nw.textPrimary}`}
              >
                Choose another preset
              </Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to home"
              onPress={goHome}
              className={`${primaryBtn} ${nw.btnPrimary}`}
            >
              <Text
                className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
              >
                Back to home
              </Text>
            </Pressable>
          </View>
          <Text className={`mt-4 text-sm ${nw.textMuted}`}>
            Add lines to this preset under the Markers tab (health marker
            presets).
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Open health marker presets tab"
            onPress={openHealthMarkerPresetsTab}
            className="mt-2 min-h-[44px] self-start justify-center rounded-lg px-2"
          >
            <Text className={`text-sm font-semibold ${nw.textPrimary}`}>
              Open Markers tab
            </Text>
          </Pressable>
        </ScrollView>
      </ScreenShell>
    );
  }

  return (
    <ScreenShell contentAlign="stretch">
      <ScrollView keyboardShouldPersistTaps="handled" className="flex-1">
        <Text
          className={`text-xl font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Standalone health markers
        </Text>
        <Text className={`mt-2 text-sm ${nw.textMuted}`}>
          {`Step ${activeIndex + 1} of ${lines.length}`}
        </Text>

        {feedback ? (
          <Text
            accessibilityRole="alert"
            className={`mt-4 text-sm ${nw.textError}`}
          >
            {feedback}
          </Text>
        ) : null}

        {currentLine ? (
          <View className="mt-4 gap-4">
            <Text className={`text-lg font-semibold ${nw.textInk}`}>
              {markerLineTitle(currentLine)}
            </Text>
            {currentLine.marker_kind === 'blood_pressure' ? (
              <View className="gap-4">
                <View>
                  <Text className={`mb-1 text-sm font-medium ${nw.textInk}`}>
                    Systolic
                  </Text>
                  <TextInput
                    accessibilityLabel="Systolic blood pressure"
                    keyboardType="decimal-pad"
                    value={currentDraft.systolic}
                    editable={!saving}
                    onChangeText={(t) => {
                      patchCurrentLineDraft({ systolic: t });
                    }}
                    className={`min-h-[44px] rounded-lg px-3 py-2 ${nw.input}`}
                  />
                </View>
                <View>
                  <Text className={`mb-1 text-sm font-medium ${nw.textInk}`}>
                    Diastolic
                  </Text>
                  <TextInput
                    accessibilityLabel="Diastolic blood pressure"
                    keyboardType="decimal-pad"
                    value={currentDraft.diastolic}
                    editable={!saving}
                    onChangeText={(t) => {
                      patchCurrentLineDraft({ diastolic: t });
                    }}
                    className={`min-h-[44px] rounded-lg px-3 py-2 ${nw.input}`}
                  />
                </View>
              </View>
            ) : (
              <View>
                <Text className={`mb-1 text-sm font-medium ${nw.textInk}`}>
                  Value
                </Text>
                <TextInput
                  accessibilityLabel="Marker value"
                  keyboardType="decimal-pad"
                  value={currentDraft.value}
                  editable={!saving}
                  onChangeText={(t) => {
                    patchCurrentLineDraft({ value: t });
                  }}
                  className={`min-h-[44px] rounded-lg px-3 py-2 ${nw.input}`}
                />
              </View>
            )}
            <View>
              <Text className={`mb-1 text-sm font-medium ${nw.textInk}`}>
                Notes (optional)
              </Text>
              <TextInput
                accessibilityLabel="Notes optional"
                multiline
                numberOfLines={3}
                value={currentDraft.notes}
                editable={!saving}
                onChangeText={(t) => {
                  patchCurrentLineDraft({ notes: t });
                }}
                className={`min-h-[88px] rounded-lg px-3 py-2 ${nw.input}`}
              />
            </View>
          </View>
        ) : null}

        <View className="mt-6 gap-3">
          {currentLine ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Skip this marker"
              disabled={!canSkip || saving}
              onPress={() => {
                void (async () => {
                  if (activeIndex >= lines.length - 1) {
                    setFeedback(null);
                    const saved = linesSavedCount;
                    const message =
                      saved === 0
                        ? 'Finished logging health markers. No markers were saved; the last line was skipped.'
                        : saved === 1
                          ? 'Finished logging health markers. One marker was saved. The last line was not saved.'
                          : `Finished logging health markers. ${saved} markers were saved. The last line was not saved.`;
                    await announce(message, { politeness: 'assertive' });
                    queueMicrotask(() => {
                      setPhase('complete');
                    });
                    return;
                  }
                  setActiveIndex((prev) => prev + 1);
                })();
              }}
              className={`${secondaryBtn} ${!canSkip || saving ? 'opacity-50' : ''}`}
            >
              <Text
                className={`text-center text-base font-semibold ${nw.textPrimary}`}
              >
                Skip marker
              </Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              saving
                ? 'Saving'
                : activeIndex >= lines.length - 1
                  ? 'Finish and save'
                  : 'Save and go to next marker'
            }
            disabled={saving || !currentLine}
            onPress={() => {
              void onNext();
            }}
            className={`${primaryBtn} ${saving || !currentLine ? 'opacity-50' : ''} ${nw.btnPrimary}`}
          >
            <Text
              className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
            >
              {saving
                ? 'Saving…'
                : activeIndex >= lines.length - 1
                  ? 'Finish'
                  : 'Next'}
            </Text>
          </Pressable>
        </View>
      </ScrollView>
    </ScreenShell>
  );
}
