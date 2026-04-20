import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import type { RouteProp } from '@react-navigation/native';
import {
  CommonActions,
  useNavigation,
  useRoute,
} from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  PresetSymptomRow,
  SymptomPromptAnswer,
  SymptomPromptAnswers,
} from '@abstrack/types';
import {
  createDefaultSymptomPromptAnswer,
  episodeSymptomRowsToAnswersMap,
  symptomPromptAnswerHasValue,
} from '@abstrack/types';
import {
  deleteEpisodeSymptomAnswer,
  listEpisodeSymptomsForEpisode,
  listPresetSymptomsForPreset,
  upsertEpisodeSymptomAnswer,
} from '@abstrack/supabase';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from '../../lib/episodes/symptom-prompt-session-store';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { SymptomPromptResponseField } from '../components/episode-flow/SymptomPromptResponseField';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { nw } from '../theme/app-nativewind-classes';

type SymptomPromptRoute = RouteProp<MainStackParamList, 'SymptomPrompt'>;
type SymptomPromptNav = NativeStackNavigationProp<
  MainStackParamList,
  'SymptomPrompt'
>;

function clampIndex(index: number, length: number): number {
  if (length <= 0) {
    return 0;
  }
  if (!Number.isFinite(index)) {
    return 0;
  }
  const i = Math.trunc(index);
  return Math.max(0, Math.min(i, length - 1));
}

/** Queue key so the same preset symptom id does not serialize writes across episodes. */
function lineWriteQueueKey(episodeId: string, presetSymptomId: string): string {
  return `${episodeId}:${presetSymptomId}`;
}

/** Debounce Supabase writes for free-text answers (matches web episode flow). */
const SERVER_SYMPTOM_PERSIST_DEBOUNCE_MS = 300;

/**
 * Linear symptom stepper for the active episode’s selected preset (Week 5 skeleton).
 *
 * @returns One symptom at a time with back/next and session-scoped progress.
 */
export function SymptomPromptScreen() {
  const navigation = useNavigation<SymptomPromptNav>();
  const route = useRoute<SymptomPromptRoute>();
  const { episodeId, symptomPresetId } = route.params;

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetSymptomRow[]>([]);
  const [phase, setPhase] = useState<'prompting' | 'complete'>('prompting');

  const [activeIndex, setActiveIndex] = useState(
    () => getSymptomPromptSession(episodeId).activeIndex,
  );
  const [answers, setAnswers] = useState(
    () => getSymptomPromptSession(episodeId).answers,
  );
  const answersRef = useRef(answers);
  const activeIndexRef = useRef(activeIndex);
  const episodeIdRef = useRef(episodeId);
  const serverPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Latest debounced free-text payload for Supabase; read in {@link flushPendingServerPersist}. */
  const pendingServerFreeTextPersistRef = useRef<{
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  } | null>(null);
  /**
   * Per (episode, preset symptom) write queue — ordering is within the active episode only, not
   * across `episodeId` changes while this screen stays mounted.
   */
  const lineWriteQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const userIdRef = useRef<string | null>(null);
  /** Bumps on each `load()` start and on effect cleanup so in-flight loads ignore stale results after unmount, retry, or param change. */
  const loadGenRef = useRef(0);
  /**
   * Bumped only by {@link cancelPendingServerPersist}. Gates {@link setPersistError} when a cancel
   * invalidates UI feedback; queued writes still run for the episode id captured at enqueue time.
   */
  const serverPersistEpochRef = useRef(0);
  /**
   * Monotonic id per enqueue; only matching completions update {@link setPersistError} so
   * cross-line out-of-order results cannot clobber a newer failure or success state.
   */
  const persistUiAttemptRef = useRef(0);
  /** Suppresses {@link setPersistError} after unmount. */
  const isMountedRef = useRef(true);
  const allowRemovalRef = useRef(false);

  /**
   * Caches the auth user id on {@link userIdRef}. Called from {@link load} before `ready`, and
   * from {@link executeServerPersist} so writes never depend on a separate mount-only `getUser()`.
   */
  const resolveSessionUserId = useCallback(
    async (
      supabase: ReturnType<typeof getMobileSupabaseClient>,
    ): Promise<string | null> => {
      if (userIdRef.current) {
        return userIdRef.current;
      }
      const {
        data: { user },
      } = await supabase.auth.getUser();
      const id = user?.id ?? null;
      userIdRef.current = id;
      return id;
    },
    [],
  );

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const executeServerPersist = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      const enqueueEpisodeId = episodeIdRef.current;
      const enqueueEpoch = serverPersistEpochRef.current;
      persistUiAttemptRef.current += 1;
      const attemptId = persistUiAttemptRef.current;
      const queueKey = lineWriteQueueKey(enqueueEpisodeId, line.id);

      const queues = lineWriteQueueRef.current;
      const previous = queues.get(queueKey) ?? Promise.resolve();
      const next = previous
        .catch(() => {
          // Keep the chain alive so later writes still run.
        })
        .then(async () => {
          const targetEpisodeId = enqueueEpisodeId;
          const supabase = getMobileSupabaseClient();
          const uid = await resolveSessionUserId(supabase);
          if (!uid) {
            if (
              isMountedRef.current &&
              episodeIdRef.current === enqueueEpisodeId &&
              enqueueEpoch === serverPersistEpochRef.current &&
              attemptId === persistUiAttemptRef.current
            ) {
              setPersistError(
                'Your session could not be verified. Try signing in again.',
              );
            }
            return;
          }
          const r = await upsertEpisodeSymptomAnswer(supabase, {
            userId: uid,
            episodeId: targetEpisodeId,
            line,
            answer,
          });
          if (enqueueEpoch !== serverPersistEpochRef.current) {
            return;
          }
          if (!isMountedRef.current) {
            return;
          }
          if (episodeIdRef.current !== enqueueEpisodeId) {
            return;
          }
          if (attemptId !== persistUiAttemptRef.current) {
            return;
          }
          if (!r.ok) {
            setPersistError(r.error.message);
          } else {
            setPersistError(null);
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId],
  );

  const executeServerDelete = useCallback(
    (line: PresetSymptomRow) => {
      const enqueueEpisodeId = episodeIdRef.current;
      const enqueueEpoch = serverPersistEpochRef.current;
      persistUiAttemptRef.current += 1;
      const attemptId = persistUiAttemptRef.current;
      const queueKey = lineWriteQueueKey(enqueueEpisodeId, line.id);

      const queues = lineWriteQueueRef.current;
      const previous = queues.get(queueKey) ?? Promise.resolve();
      const next = previous
        .catch(() => {
          // Keep the chain alive so later writes still run.
        })
        .then(async () => {
          const targetEpisodeId = enqueueEpisodeId;
          const supabase = getMobileSupabaseClient();
          const uid = await resolveSessionUserId(supabase);
          if (!uid) {
            if (
              isMountedRef.current &&
              episodeIdRef.current === enqueueEpisodeId &&
              enqueueEpoch === serverPersistEpochRef.current &&
              attemptId === persistUiAttemptRef.current
            ) {
              setPersistError(
                'Your session could not be verified. Try signing in again.',
              );
            }
            return;
          }
          const r = await deleteEpisodeSymptomAnswer(supabase, {
            episodeId: targetEpisodeId,
            presetSymptomId: line.id,
          });
          if (enqueueEpoch !== serverPersistEpochRef.current) {
            return;
          }
          if (!isMountedRef.current) {
            return;
          }
          if (episodeIdRef.current !== enqueueEpisodeId) {
            return;
          }
          if (attemptId !== persistUiAttemptRef.current) {
            return;
          }
          if (!r.ok) {
            setPersistError(r.error.message);
          } else {
            setPersistError(null);
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId],
  );

  /**
   * Cancels the debounced server timer, then **immediately** persists the latest free-text
   * `{ line, answer }` from {@link pendingServerFreeTextPersistRef} (if any). Call from
   * Next/Back, `useLayoutEffect` (episode change), and unmount so the last keystrokes are not lost.
   */
  const flushPendingServerPersist = useCallback(() => {
    if (serverPersistTimerRef.current !== null) {
      clearTimeout(serverPersistTimerRef.current);
      serverPersistTimerRef.current = null;
    }
    const pending = pendingServerFreeTextPersistRef.current;
    pendingServerFreeTextPersistRef.current = null;
    if (!pending) {
      return;
    }
    executeServerPersist(pending.line, pending.answer);
  }, [executeServerPersist]);

  /**
   * Cancels pending debounced free-text upserts and invalidates older in-flight persists.
   * Used on skip/delete so delayed upserts cannot recreate deleted symptom rows.
   */
  const cancelPendingServerPersist = useCallback(() => {
    if (serverPersistTimerRef.current !== null) {
      clearTimeout(serverPersistTimerRef.current);
      serverPersistTimerRef.current = null;
    }
    pendingServerFreeTextPersistRef.current = null;
    serverPersistEpochRef.current += 1;
  }, []);

  /**
   * Schedules or runs a server upsert. User id is **not** read here: {@link executeServerPersist}
   * always calls {@link resolveSessionUserId} so the first answer after load cannot silently skip.
   */
  const schedulePersistToSupabase = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      if (!symptomPromptAnswerHasValue(answer)) {
        cancelPendingServerPersist();
        executeServerDelete(line);
        return;
      }
      if (answer.type === 'free_text') {
        pendingServerFreeTextPersistRef.current = { line, answer };
        if (serverPersistTimerRef.current !== null) {
          clearTimeout(serverPersistTimerRef.current);
        }
        serverPersistTimerRef.current = setTimeout(() => {
          serverPersistTimerRef.current = null;
          const pending = pendingServerFreeTextPersistRef.current;
          pendingServerFreeTextPersistRef.current = null;
          if (pending) {
            executeServerPersist(pending.line, pending.answer);
          }
        }, SERVER_SYMPTOM_PERSIST_DEBOUNCE_MS);
      } else {
        pendingServerFreeTextPersistRef.current = null;
        if (serverPersistTimerRef.current !== null) {
          clearTimeout(serverPersistTimerRef.current);
          serverPersistTimerRef.current = null;
        }
        executeServerPersist(line, answer);
      }
    },
    [cancelPendingServerPersist, executeServerDelete, executeServerPersist],
  );

  useEffect(() => {
    return () => {
      // Do not bump serverPersistEpochRef here — queued per-line writes should still reach Supabase;
      // isMountedRef gates setPersistError after unmount.
      flushPendingServerPersist();
    };
  }, [flushPendingServerPersist]);

  const persist = useCallback(
    (nextIndex: number, nextAnswers: typeof answers) => {
      setSymptomPromptSession(episodeId, {
        activeIndex: nextIndex,
        answers: nextAnswers,
      });
    },
    [episodeId],
  );

  const load = useCallback(async () => {
    const myGen = ++loadGenRef.current;
    const stale = () => myGen !== loadGenRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistError(null);
    setPhase('prompting');
    try {
      const supabase = getMobileSupabaseClient();
      const uid = await resolveSessionUserId(supabase);
      if (stale()) {
        return;
      }
      if (!uid) {
        setErrorMessage(
          'You must be signed in to save symptom answers. Try signing in again.',
        );
        setStatus('error');
        return;
      }
      const result = await listPresetSymptomsForPreset(
        supabase,
        symptomPresetId,
      );
      if (stale()) {
        return;
      }
      if (!result.ok) {
        setErrorMessage(result.error.message);
        setStatus('error');
        return;
      }
      setLines(result.data);
      const fromServer = await listEpisodeSymptomsForEpisode(
        supabase,
        episodeId,
      );
      if (stale()) {
        return;
      }
      const serverAnswers = fromServer.ok
        ? episodeSymptomRowsToAnswersMap(fromServer.data)
        : {};
      const session = getSymptomPromptSession(episodeId);
      // Session overlays server so local drafts survive hydrate (debounced/offline/failed sync).
      const mergedAnswers = { ...serverAnswers, ...session.answers };
      const idx = clampIndex(session.activeIndex, result.data.length);
      activeIndexRef.current = idx;
      setActiveIndex(idx);
      setAnswers(mergedAnswers);
      answersRef.current = mergedAnswers;
      setSymptomPromptSession(episodeId, {
        activeIndex: idx,
        answers: mergedAnswers,
      });
      if (!fromServer.ok) {
        setPersistError(fromServer.error.message);
      }
      setStatus('ready');
    } catch (caught: unknown) {
      if (stale()) {
        return;
      }
      const message =
        caught instanceof Error ? caught.message : 'Could not load symptoms.';
      setErrorMessage(message);
      setStatus('error');
    }
  }, [episodeId, symptomPresetId, resolveSessionUserId]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  useLayoutEffect(() => {
    flushPendingServerPersist();
    episodeIdRef.current = episodeId;
    const s = getSymptomPromptSession(episodeId);
    activeIndexRef.current = s.activeIndex;
    setActiveIndex(s.activeIndex);
    setAnswers(s.answers);
    answersRef.current = s.answers;
    setPhase('prompting');
    setStatus('loading');
    setErrorMessage(null);
    setPersistError(null);
    setLines([]);
  }, [episodeId, symptomPresetId, flushPendingServerPersist]);

  const currentLine = lines[activeIndex] ?? null;
  const currentAnswer = currentLine ? answers[currentLine.id] : undefined;
  const currentLineAnswered = symptomPromptAnswerHasValue(currentAnswer);
  const canProceedWithNext = !currentLine || currentLineAnswered;
  const canSkipCurrentLine = Boolean(currentLine) && !currentLineAnswered;
  const stepLabel =
    lines.length === 0
      ? 'No symptoms'
      : `Step ${activeIndex + 1} of ${lines.length}`;

  useEffect(() => {
    if (phase !== 'prompting' || !currentLine) {
      return;
    }
    announce(`${stepLabel}. ${currentLine.symptom_name}.`);
  }, [activeIndex, currentLine, lines.length, phase, stepLabel]);

  const onChangeAnswer = (next: SymptomPromptAnswer) => {
    if (!currentLine) {
      return;
    }
    const merged: SymptomPromptAnswers = {
      ...answersRef.current,
      [currentLine.id]: next,
    };
    answersRef.current = merged;
    setAnswers(merged);
    persist(activeIndexRef.current, merged);
    schedulePersistToSupabase(currentLine, next);
  };

  const goBackStep = () => {
    flushPendingServerPersist();
    const idx = activeIndexRef.current;
    if (idx <= 0) {
      return;
    }
    const next = idx - 1;
    activeIndexRef.current = next;
    setActiveIndex(next);
    persist(next, answersRef.current);
    announce(`Back to step ${next + 1} of ${lines.length}.`);
  };

  const confirmExitFlow = useCallback((action: () => void) => {
    Alert.alert(
      'Exit symptom flow?',
      'If you exit now, you will return home. Starting again creates a new episode.',
      [
        { text: 'Stay here', style: 'cancel' },
        {
          text: 'Exit',
          style: 'destructive',
          onPress: action,
        },
      ],
    );
  }, []);

  /** Matches {@link onFinishToHome}: reset stack to MainTabs so copy matches behavior (not `goBack`). */
  const exitSymptomFlowToHome = useCallback(() => {
    flushPendingServerPersist();
    clearSymptomPromptSession(episodeId);
    allowRemovalRef.current = true;
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
    );
  }, [episodeId, flushPendingServerPersist, navigation]);

  const requestExitToHome = useCallback(() => {
    confirmExitFlow(() => {
      exitSymptomFlowToHome();
    });
  }, [confirmExitFlow, exitSymptomFlowToHome]);

  useEffect(() => {
    const unsub = navigation.addListener('beforeRemove', (e) => {
      if (allowRemovalRef.current || phase === 'complete') {
        allowRemovalRef.current = false;
        return;
      }
      e.preventDefault();
      confirmExitFlow(() => {
        exitSymptomFlowToHome();
      });
    });
    return unsub;
  }, [confirmExitFlow, exitSymptomFlowToHome, navigation, phase]);

  const onExitFlowPress = () => {
    requestExitToHome();
  };

  const advanceToNextStep = () => {
    if (lines.length === 0) {
      setPhase('complete');
      return;
    }
    const idx = activeIndexRef.current;
    if (idx < lines.length - 1) {
      const next = idx + 1;
      activeIndexRef.current = next;
      setActiveIndex(next);
      persist(next, answersRef.current);
      return;
    }
    setPhase('complete');
    announce('Symptom list complete.');
  };

  const goNext = () => {
    flushPendingServerPersist();
    advanceToNextStep();
  };

  const skipCurrentSymptom = () => {
    if (!currentLine) {
      return;
    }
    cancelPendingServerPersist();
    const skippedAnswer = createDefaultSymptomPromptAnswer(
      currentLine.response_type,
    );
    const merged: SymptomPromptAnswers = {
      ...answersRef.current,
      [currentLine.id]: skippedAnswer,
    };
    answersRef.current = merged;
    setAnswers(merged);
    persist(activeIndexRef.current, merged);
    executeServerDelete(currentLine);
    announce(`Skipped ${currentLine.symptom_name}.`);
    advanceToNextStep();
  };

  const onFinishToHome = () => {
    clearSymptomPromptSession(episodeId);
    navigation.dispatch(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
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
          Episode symptoms
        </Text>
        {persistError ? (
          <Text
            accessibilityLiveRegion="polite"
            className={`text-sm text-amber-800 dark:text-amber-200`}
            maxFontSizeMultiplier={2}
          >
            Could not sync with the server: {persistError}
          </Text>
        ) : null}

        {phase === 'complete' ? (
          <View className="gap-4" accessibilityLiveRegion="polite">
            <Text
              className={`text-base leading-relaxed ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              You reached the end of your symptom list for this episode. You can
              return home when you are ready.
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
              loadingAccessibilityLabel="Loading symptom list"
              errorTitle="Could not load symptoms"
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
                  {stepLabel}
                </Text>

                {lines.length === 0 ? (
                  <Text
                    className={`text-base leading-relaxed ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    This preset has no symptoms yet. You can add symptoms under
                    Templates when you are not in an episode.
                  </Text>
                ) : currentLine ? (
                  <View className="gap-4">
                    <Text
                      accessibilityRole="header"
                      className={`text-xl font-semibold ${nw.textInk}`}
                      maxFontSizeMultiplier={2}
                    >
                      {currentLine.symptom_name}
                    </Text>
                    {currentLine.prompt_instruction ? (
                      <Text
                        className={`text-base leading-relaxed ${nw.textMuted}`}
                        maxFontSizeMultiplier={2}
                      >
                        {currentLine.prompt_instruction}
                      </Text>
                    ) : null}
                    <SymptomPromptResponseField
                      line={currentLine}
                      answer={answers[currentLine.id]}
                      onChange={onChangeAnswer}
                      disabled={status !== 'ready'}
                    />
                  </View>
                ) : null}

                <View className="mt-6 gap-3">
                  {activeIndex > 0 ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Previous symptom"
                      onPress={goBackStep}
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
                      accessibilityLabel="Skip this symptom"
                      accessibilityState={{ disabled: !canSkipCurrentLine }}
                      disabled={!canSkipCurrentLine}
                      onPress={skipCurrentSymptom}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className={`w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 dark:border-app-border-dark dark:bg-app-bg-dark ${
                        canSkipCurrentLine ? 'active:opacity-90' : 'opacity-50'
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
                        ? 'Finish symptom list'
                        : 'Next symptom'
                    }
                    accessibilityState={{ disabled: !canProceedWithNext }}
                    disabled={!canProceedWithNext}
                    onPress={goNext}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className={`w-full items-center justify-center rounded-xl px-3 py-4 dark:bg-red-600 ${
                      canProceedWithNext
                        ? 'bg-red-700 active:opacity-90'
                        : 'bg-red-400 opacity-60 dark:bg-red-800'
                    }`}
                  >
                    <Text className="text-center text-[17px] font-semibold text-white">
                      {lines.length === 0
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
              accessibilityLabel="Exit symptom flow"
              onPress={onExitFlowPress}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              className="mt-auto w-full items-center justify-center rounded-lg px-3 py-3 active:opacity-80"
            >
              <Text
                className={`text-base font-medium ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                Exit symptom flow
              </Text>
            </Pressable>
          </>
        )}
      </View>
    </ScreenShell>
  );
}
