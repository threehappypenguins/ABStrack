import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  EpisodeRow,
  EpisodeTemplateWithPresetsRow,
} from '@abstrack/types';
import { getActiveEpisodeForUser, PresetDataError } from '@abstrack/supabase';
import { announce } from '@abstrack/ui/native';
import {
  fetchEpisodeTemplates,
  getCurrentUserId,
} from '../../lib/episode-templates/episode-template-service';
import { clearSymptomPromptSession } from '../../lib/episodes/symptom-prompt-session-store';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { endEpisodeIfStillActiveOfflineFirst } from '../../lib/episodes/mobile-offline-first-gateway';
import { saveEpisodeWithTemplatePresets } from '../../lib/episodes/episode-start-service';
import { humanizeUnexpectedScreenError } from '../../lib/network/humanize-unexpected-screen-error';
import { getActiveEpisodeRowFromPowerSyncDb } from '../../lib/powersync/episode-powersync-local-read';
import {
  powerSyncOfflineReplicaReadsEnabled,
  powerSyncReplicaSqliteReady,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { nw } from '../theme/app-nativewind-classes';

/** Token for focus-scoped loads. */
type FocusLoadCancel = { cancelled: boolean };

const EPISODE_START_LOAD_TIMEOUT_MS = 45_000;

type EpisodeStartNav = NativeStackNavigationProp<
  MainStackParamList,
  'EpisodeStart'
>;

/**
 * Episode-start flow: if there is exactly one episode template, start the episode immediately
 * (no tap-through). Otherwise pick a template, then create an episode with both preset ids from
 * that template (no separate symptom or health-marker pickers).
 *
 * @returns Template picker and start action for the impaired-use pathway.
 */
export function EpisodeStartScreen() {
  const navigation = useNavigation<EpisodeStartNav>();
  /** Invalidates in-flight {@link load} when the screen blurs, retry runs, or a load watchdog fires. */
  const loadGenerationRef = useRef(0);
  /** Cleared on blur / completion so {@link EPISODE_START_LOAD_TIMEOUT_MS} cannot fire late. */
  const episodeStartLoadTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);
  /** Current focus session’s cancellation token; aligned with {@link loadGenerationRef} invalidation. */
  const focusCancelRef = useRef<FocusLoadCancel | null>(null);

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Set when auto-start (single template) fails; user can retry with Start episode. */
  const [episodeStartError, setEpisodeStartError] = useState<string | null>(
    null,
  );
  const [rows, setRows] = useState<EpisodeTemplateWithPresetsRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Open episode blocks starting another until resume or explicit end. */
  const [blockingActiveEpisode, setBlockingActiveEpisode] =
    useState<EpisodeRow | null>(null);
  const [resolvingActiveGate, setResolvingActiveGate] = useState(false);

  const psBridge = usePowerSyncBridgeState();
  const powerSyncDbForWrites = useMemo(
    () => (powerSyncReplicaSqliteReady(psBridge) ? psBridge.database : null),
    [psBridge],
  );

  /**
   * PowerSync bridge updates frequently during connect/first-sync (`syncConnecting`, sqlite init,
   * etc.). Those updates must **not** change {@link load}'s identity. Also, `useFocusEffect` must not
   * depend on `load`: when `navigation` (or anything else) bumps `load`, the effect would cancel
   * and restart mid-flight and strand the UI on `loading`.
   */
  const psBridgeRef = useRef(psBridge);
  useEffect(() => {
    psBridgeRef.current = psBridge;
  }, [psBridge]);

  const load = useCallback(
    async (focusCancel?: FocusLoadCancel, expectedGen?: number) => {
      const stale = () =>
        focusCancel?.cancelled === true ||
        (expectedGen !== undefined &&
          expectedGen !== loadGenerationRef.current);

      const loadTimeoutFallback =
        'Starting this screen is taking too long. Check your connection, then tap Try again.';

      try {
        setStatus('loading');
        setErrorMessage(null);
        setEpisodeStartError(null);
        setBlockingActiveEpisode(null);
        const authResult = await getCurrentUserId();
        if (stale()) {
          return;
        }
        if (!authResult.ok) {
          setErrorMessage(authResult.error.message);
          setStatus('error');
          return;
        }
        if (authResult.data === null) {
          setErrorMessage('You need to be signed in to start an episode.');
          setStatus('error');
          return;
        }
        const userId = authResult.data;

        const supabase = getMobileSupabaseClient();
        const activeResult = await getActiveEpisodeForUser(supabase, userId);
        if (stale()) {
          return;
        }

        let activeEpisodeRow: EpisodeRow | null = null;
        const bridgeForActiveRead = psBridgeRef.current;
        if (activeResult.ok) {
          activeEpisodeRow = activeResult.data;
        } else {
          const isNetwork =
            activeResult.error instanceof PresetDataError &&
            activeResult.error.code === 'network_error';
          if (
            isNetwork &&
            powerSyncOfflineReplicaReadsEnabled(bridgeForActiveRead)
          ) {
            const db = bridgeForActiveRead.database;
            if (db != null) {
              try {
                activeEpisodeRow = await getActiveEpisodeRowFromPowerSyncDb(
                  db,
                  userId,
                );
              } catch {
                activeEpisodeRow = null;
              }
            }
          }
          if (!activeEpisodeRow) {
            if (!isNetwork) {
              setErrorMessage(activeResult.error.message);
              setStatus('error');
              return;
            }
            // Network and no replicated active episode — try templates (may also be offline).
          }
        }

        if (activeEpisodeRow) {
          setBlockingActiveEpisode(activeEpisodeRow);
          setRows([]);
          setSubmitting(false);
          setStatus('ready');
          return;
        }

        const bridgeForTemplates = psBridgeRef.current;
        const result = await fetchEpisodeTemplates({
          powerSyncOfflineRead: {
            database: bridgeForTemplates.database,
            replicationReady:
              powerSyncOfflineReplicaReadsEnabled(bridgeForTemplates),
          },
        });
        if (stale()) {
          return;
        }
        if (!result.ok) {
          const offlineTemplates =
            result.error instanceof PresetDataError &&
            result.error.code === 'network_error';
          setErrorMessage(
            offlineTemplates
              ? 'You are offline. Connect to the internet to load episode templates, or go back to Home to continue an episode that was already synced to this device.'
              : result.error.message,
          );
          setStatus('error');
          return;
        }

        setRows(result.data);

        if (result.data.length === 1) {
          const template = result.data[0];
          setSubmitting(true);
          let didNavigateToSymptomPrompt = false;
          try {
            const saveResult = await saveEpisodeWithTemplatePresets({
              userId,
              symptomPresetId: template.symptom_preset_id,
              healthMarkerPresetId: template.health_marker_preset_id,
              powerSyncDatabase: powerSyncReplicaSqliteReady(
                psBridgeRef.current,
              )
                ? psBridgeRef.current.database
                : null,
            });
            if (stale()) {
              return;
            }
            if (!saveResult.ok) {
              setSelectedId(template.id);
              setEpisodeStartError(saveResult.error.message);
              announce(saveResult.error.message);
              setStatus('ready');
              return;
            }
            announce('Episode started.');
            try {
              navigation.replace('SymptomPrompt', {
                episodeId: saveResult.data.id,
                symptomPresetId: template.symptom_preset_id,
              });
              didNavigateToSymptomPrompt = true;
            } catch (navErr) {
              const msg =
                navErr instanceof Error
                  ? navErr.message
                  : 'Could not open symptoms for this episode.';
              setEpisodeStartError(msg);
              announce(msg, { politeness: 'assertive' });
              setStatus('ready');
            }
          } finally {
            if (!stale() && !didNavigateToSymptomPrompt) {
              setSubmitting(false);
            }
          }
          return;
        }

        setSubmitting(false);
        setSelectedId((prev) => {
          if (prev && result.data.some((r) => r.id === prev)) {
            return prev;
          }
          return null;
        });
        setStatus('ready');
      } catch (caught) {
        if (stale()) {
          return;
        }
        setErrorMessage(
          humanizeUnexpectedScreenError(caught, loadTimeoutFallback),
        );
        setStatus('error');
      }
    },
    [navigation],
  );

  const loadRef = useRef(load);
  loadRef.current = load;

  useFocusEffect(
    useCallback(() => {
      loadGenerationRef.current += 1;
      const generation = loadGenerationRef.current;
      const focusCancel: FocusLoadCancel = { cancelled: false };
      focusCancelRef.current = focusCancel;

      void (async () => {
        const loadTimeoutFallback =
          'Starting this screen is taking too long. Check your connection, then tap Try again.';
        try {
          await Promise.race([
            loadRef.current(focusCancel, generation),
            new Promise<never>((_, reject) => {
              episodeStartLoadTimeoutRef.current = setTimeout(
                () => reject(new Error(loadTimeoutFallback)),
                EPISODE_START_LOAD_TIMEOUT_MS,
              );
            }),
          ]);
        } catch (caught) {
          focusCancel.cancelled = true;
          loadGenerationRef.current += 1;
          setErrorMessage(
            humanizeUnexpectedScreenError(caught, loadTimeoutFallback),
          );
          setStatus('error');
        } finally {
          if (episodeStartLoadTimeoutRef.current != null) {
            clearTimeout(episodeStartLoadTimeoutRef.current);
            episodeStartLoadTimeoutRef.current = null;
          }
        }
      })();

      return () => {
        if (episodeStartLoadTimeoutRef.current != null) {
          clearTimeout(episodeStartLoadTimeoutRef.current);
          episodeStartLoadTimeoutRef.current = null;
        }
        focusCancel.cancelled = true;
        loadGenerationRef.current += 1;
      };
    }, []),
  );

  const onSelectTemplate = (id: string) => {
    setSelectedId(id);
    setEpisodeStartError(null);
    announce(`${rows.find((r) => r.id === id)?.name ?? 'Template'} selected.`);
  };

  const onStartEpisode = async () => {
    if (selectedId === null || submitting) {
      return;
    }
    const template = rows.find((r) => r.id === selectedId);
    if (!template) {
      return;
    }
    setEpisodeStartError(null);
    setSubmitting(true);
    let didNavigateToSymptomPrompt = false;
    try {
      const authResult = await getCurrentUserId();
      if (!authResult.ok) {
        setEpisodeStartError(authResult.error.message);
        announce(authResult.error.message);
        return;
      }
      if (authResult.data === null) {
        const message = 'You need to be signed in to start an episode.';
        setEpisodeStartError(message);
        announce(message);
        return;
      }
      const result = await saveEpisodeWithTemplatePresets({
        userId: authResult.data,
        symptomPresetId: template.symptom_preset_id,
        healthMarkerPresetId: template.health_marker_preset_id,
        powerSyncDatabase: powerSyncReplicaSqliteReady(psBridgeRef.current)
          ? psBridgeRef.current.database
          : null,
      });
      if (!result.ok) {
        setEpisodeStartError(result.error.message);
        announce(result.error.message);
        return;
      }
      setEpisodeStartError(null);
      announce('Episode started.');
      navigation.replace('SymptomPrompt', {
        episodeId: result.data.id,
        symptomPresetId: template.symptom_preset_id,
      });
      didNavigateToSymptomPrompt = true;
    } finally {
      if (!didNavigateToSymptomPrompt) {
        setSubmitting(false);
      }
    }
  };

  const onResumeActiveEpisode = useCallback(() => {
    const row = blockingActiveEpisode;
    if (!row) {
      return;
    }
    if (row.post_marker_step_completed_at) {
      navigation.replace('HealthMarkerPrompt', {
        episodeId: row.id,
        resume: true,
        hub: true,
      });
      return;
    }
    const presetId = row.symptom_preset_id;
    if (typeof presetId !== 'string' || !presetId) {
      return;
    }
    navigation.replace('SymptomPrompt', {
      episodeId: row.id,
      symptomPresetId: presetId,
      resume: true,
    });
  }, [blockingActiveEpisode, navigation]);

  const onEndActiveEpisodeAndStartNew = useCallback(async () => {
    const row = blockingActiveEpisode;
    if (!row || resolvingActiveGate) {
      return;
    }
    setResolvingActiveGate(true);
    setEpisodeStartError(null);
    try {
      const supabase = getMobileSupabaseClient();
      const end = await endEpisodeIfStillActiveOfflineFirst(
        supabase,
        powerSyncDbForWrites,
        row.id,
        new Date().toISOString(),
        row.started_at,
      );
      if (!end.ok) {
        setEpisodeStartError(end.error.message);
        announce(end.error.message);
        return;
      }
      clearSymptomPromptSession(row.id);
      loadGenerationRef.current += 1;
      const gen = loadGenerationRef.current;
      await loadRef.current(
        focusCancelRef.current ?? { cancelled: false },
        gen,
      );
      if (!end.data.didEnd) {
        return;
      }
      const verify = await getActiveEpisodeForUser(supabase, row.user_id);
      if (!verify.ok) {
        setEpisodeStartError(verify.error.message);
        return;
      }
      if (!verify.data) {
        announce('Previous episode closed. You can start a new one.');
      } else {
        setEpisodeStartError(
          'We could not confirm your previous episode is closed. Try Continue this episode or try again.',
        );
      }
    } finally {
      setResolvingActiveGate(false);
    }
  }, [blockingActiveEpisode, powerSyncDbForWrites, resolvingActiveGate]);

  const gatePresetId = blockingActiveEpisode?.symptom_preset_id;
  const gateAtEndStep =
    blockingActiveEpisode?.post_marker_step_completed_at != null;
  const canResumeFromGate =
    gateAtEndStep ||
    (typeof gatePresetId === 'string' && gatePresetId.length > 0);

  return (
    <ScreenShell contentAlign="stretch">
      <View className="min-h-0 flex-1 gap-4">
        <Text
          testID="episode-start-screen-title"
          accessibilityRole="header"
          className={`text-[22px] font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          {blockingActiveEpisode
            ? 'Episode already in progress'
            : 'Start an episode'}
        </Text>

        {blockingActiveEpisode ? (
          <View className="gap-4">
            <Text
              className={`text-base leading-relaxed ${nw.textInk}`}
              maxFontSizeMultiplier={2}
              accessibilityLiveRegion="polite"
            >
              You already have one episode open that is not finished. Only one
              episode can be open at a time. Choose what to do next.
            </Text>
            {!canResumeFromGate ? (
              <Text
                className={`text-base leading-relaxed ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                This episode is missing preset data, so it cannot be resumed.
                End this episode to start a new one.
              </Text>
            ) : null}
            {episodeStartError ? (
              <Text
                accessibilityRole="alert"
                className={`text-base leading-relaxed ${nw.textError}`}
                maxFontSizeMultiplier={2}
              >
                {episodeStartError}
              </Text>
            ) : null}
            {canResumeFromGate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue this episode"
                accessibilityHint="Opens your in-progress episode at the next step"
                accessibilityState={{ disabled: resolvingActiveGate }}
                disabled={resolvingActiveGate}
                onPress={onResumeActiveEpisode}
                className="min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 dark:bg-red-600"
              >
                <Text className="text-center text-[18px] font-semibold text-white">
                  Continue this episode
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                resolvingActiveGate
                  ? 'Closing episode'
                  : 'End this episode and start a new one'
              }
              accessibilityHint="Closes the open episode so you can start a new one"
              accessibilityState={{ disabled: resolvingActiveGate }}
              disabled={resolvingActiveGate}
              onPress={() => {
                void onEndActiveEpisodeAndStartNew();
              }}
              className={`min-h-[56px] items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-4 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark ${
                canResumeFromGate
                  ? ''
                  : 'bg-red-700 dark:bg-red-600 border-transparent'
              }`}
            >
              <Text
                className={`text-center text-[18px] font-semibold ${
                  canResumeFromGate ? nw.textInk : 'text-white'
                }`}
              >
                {resolvingActiveGate
                  ? 'Closing episode…'
                  : 'End this episode and start a new one'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!blockingActiveEpisode ? (
          <AsyncScreenContainer
            status={status}
            loadingAccessibilityLabel={
              submitting ? 'Starting episode' : 'Loading episode templates'
            }
            errorTitle="Could not load templates"
            errorMessage={errorMessage ?? undefined}
            onRetry={() => {
              loadGenerationRef.current += 1;
              const gen = loadGenerationRef.current;
              const token = focusCancelRef.current ?? { cancelled: false };
              focusCancelRef.current = token;
              token.cancelled = false;
              void loadRef.current(token, gen);
            }}
          >
            <ScrollView
              testID="episode-start-template-scroll"
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {rows.length === 1 ? (
                <Text
                  className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Your episode uses the template below for symptoms and health
                  markers.
                </Text>
              ) : rows.length > 1 ? (
                <Text
                  className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Tap one template for this episode. It sets both your symptom
                  list and health markers for this episode.
                </Text>
              ) : null}

              {episodeStartError ? (
                <Text
                  accessibilityRole="alert"
                  className={`mb-4 text-base leading-relaxed ${nw.textError}`}
                  maxFontSizeMultiplier={2}
                >
                  {episodeStartError}
                </Text>
              ) : null}

              {rows.length === 0 ? (
                <View
                  className="rounded-xl bg-app-bg p-4 dark:bg-app-bg-dark"
                  accessibilityRole="text"
                >
                  <Text
                    className={`text-base leading-relaxed ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    You do not have any episode templates yet. Open the
                    Templates tab, create a template, then come back here.
                  </Text>
                </View>
              ) : (
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Episode templates"
                >
                  {rows.map((row) => {
                    const selected = selectedId === row.id;
                    return (
                      <Pressable
                        key={row.id}
                        testID={`episode-start-template-option-${row.id}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: submitting }}
                        accessibilityLabel={`${row.name}. Symptoms: ${row.symptom_preset.name}. Health markers: ${row.health_marker_preset.name}.`}
                        onPress={() => {
                          if (!submitting) {
                            onSelectTemplate(row.id);
                          }
                        }}
                        className={`mb-3 rounded-2xl border-2 p-4 active:opacity-90 ${
                          selected
                            ? 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                            : 'border-app-border bg-app-bg dark:border-app-border-dark dark:bg-app-bg-dark'
                        }`}
                      >
                        <Text
                          className={`text-[18px] font-semibold ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        >
                          {row.name}
                        </Text>
                        <Text
                          className={`mt-2 text-sm leading-relaxed ${nw.textMuted}`}
                          maxFontSizeMultiplier={2}
                        >
                          Symptoms: {row.symptom_preset.name}
                        </Text>
                        <Text
                          className={`mt-1 text-sm leading-relaxed ${nw.textMuted}`}
                          maxFontSizeMultiplier={2}
                        >
                          Markers: {row.health_marker_preset.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {rows.length > 0 ? (
                <Pressable
                  testID="episode-start-submit"
                  accessibilityRole="button"
                  accessibilityLabel="Start episode with selected template"
                  accessibilityState={{
                    disabled: selectedId === null || submitting,
                  }}
                  disabled={selectedId === null || submitting}
                  onPress={() => {
                    void onStartEpisode();
                  }}
                  className={`mt-4 min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 disabled:opacity-50 dark:bg-red-600`}
                >
                  <Text className="text-center text-[18px] font-semibold text-white">
                    {submitting ? 'Starting…' : 'Start episode'}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </AsyncScreenContainer>
        ) : null}
      </View>
    </ScreenShell>
  );
}
