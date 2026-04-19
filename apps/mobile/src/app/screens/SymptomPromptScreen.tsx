import React, {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
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
import { episodeSymptomRowsToAnswersMap } from '@abstrack/types';
import {
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
  const serverPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const userIdRef = useRef<string | null>(null);
  /** Bumps on each `load()` start and on effect cleanup so in-flight loads ignore stale results after unmount, retry, or param change. */
  const loadGenRef = useRef(0);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const supabase = getMobileSupabaseClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (!cancelled) {
        userIdRef.current = user?.id ?? null;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (serverPersistTimerRef.current === null) {
        return;
      }
      clearTimeout(serverPersistTimerRef.current);
      serverPersistTimerRef.current = null;
    };
  }, []);

  const persist = useCallback(
    (nextIndex: number, nextAnswers: typeof answers) => {
      setSymptomPromptSession(episodeId, {
        activeIndex: nextIndex,
        answers: nextAnswers,
      });
    },
    [episodeId],
  );

  const flushPendingServerPersist = useCallback(() => {
    if (serverPersistTimerRef.current === null) {
      return;
    }
    clearTimeout(serverPersistTimerRef.current);
    serverPersistTimerRef.current = null;
  }, []);

  const schedulePersistToSupabase = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      const uid = userIdRef.current;
      if (!uid) {
        return;
      }
      const run = () => {
        void (async () => {
          const supabase = getMobileSupabaseClient();
          const r = await upsertEpisodeSymptomAnswer(supabase, {
            userId: uid,
            episodeId,
            line,
            answer,
          });
          if (!r.ok) {
            setPersistError(r.error.message);
          } else {
            setPersistError(null);
          }
        })();
      };
      if (answer.type === 'free_text') {
        if (serverPersistTimerRef.current !== null) {
          clearTimeout(serverPersistTimerRef.current);
        }
        serverPersistTimerRef.current = setTimeout(() => {
          serverPersistTimerRef.current = null;
          run();
        }, SERVER_SYMPTOM_PERSIST_DEBOUNCE_MS);
      } else {
        run();
      }
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
      const mergedAnswers = { ...session.answers, ...serverAnswers };
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
  }, [episodeId, symptomPresetId]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  useLayoutEffect(() => {
    if (serverPersistTimerRef.current !== null) {
      clearTimeout(serverPersistTimerRef.current);
      serverPersistTimerRef.current = null;
    }
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
  }, [episodeId, symptomPresetId]);

  const currentLine = lines[activeIndex] ?? null;
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
    if (idx > 0) {
      const next = idx - 1;
      activeIndexRef.current = next;
      setActiveIndex(next);
      persist(next, answersRef.current);
      announce(`Back to step ${next + 1} of ${lines.length}.`);
    } else {
      navigation.goBack();
    }
  };

  const goNext = () => {
    flushPendingServerPersist();
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
            Could not save to the server: {persistError}
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

              <View className="mt-6 flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    activeIndex === 0
                      ? 'Go back to previous screen'
                      : 'Previous symptom'
                  }
                  onPress={goBackStep}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="min-w-[120px] flex-1 items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-3 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark"
                >
                  <Text
                    className={`text-center text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    {activeIndex === 0 ? 'Exit' : 'Back'}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={
                    lines.length > 0 && activeIndex >= lines.length - 1
                      ? 'Finish symptom list'
                      : 'Next symptom'
                  }
                  onPress={goNext}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="min-w-[120px] flex-1 items-center justify-center rounded-xl bg-red-700 px-3 py-4 active:opacity-90 dark:bg-red-600"
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
        )}
      </View>
    </ScreenShell>
  );
}
