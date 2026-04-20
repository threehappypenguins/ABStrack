'use client';

import { useRouter } from 'next/navigation';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type {
  PresetSymptomRow,
  SymptomPromptAnswer,
  SymptomPromptAnswers,
} from '@abstrack/types';
import {
  createDefaultSymptomPromptAnswer,
  createInitialSymptomPromptSession,
  episodeSymptomRowsToAnswersMap,
  symptomPromptAnswerHasValue,
} from '@abstrack/types';
import {
  deleteEpisodeSymptomAnswer,
  listEpisodeSymptomsForEpisode,
  listPresetSymptomsForPreset,
  upsertEpisodeSymptomAnswer,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from '@/lib/episode-flow/symptom-prompt-session-store';
import { SymptomPromptResponseField } from './SymptomPromptResponseField';

export type SymptomPromptFlowProps = {
  /** `episodes.id` from the route. */
  episodeId: string;
  /** `symptom_presets.id` for the active episode (from template at start). */
  symptomPresetId: string;
};

/** Delay before writing free-text drafts to `sessionStorage` (keystrokes stay snappy in React state). */
const FREE_TEXT_PERSIST_DEBOUNCE_MS = 300;

/** Same debounce for Supabase `episode_symptoms` writes (plaintext columns under RLS). */
const SERVER_SYMPTOM_PERSIST_DEBOUNCE_MS = 300;

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

/**
 * Linear symptom stepper for the active episode’s preset (Week 5 skeleton).
 *
 * @param props - Episode and symptom preset identifiers.
 * @returns One symptom at a time with back/next and session-scoped progress.
 */
export function SymptomPromptFlow({
  episodeId,
  symptomPresetId,
}: SymptomPromptFlowProps) {
  const router = useRouter();
  const { announce } = useAnnounce();

  const [hydrated, setHydrated] = useState(false);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistError, setPersistError] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetSymptomRow[]>([]);
  const [phase, setPhase] = useState<'prompting' | 'complete'>('prompting');

  const [activeIndex, setActiveIndex] = useState(0);
  const [answers, setAnswers] = useState(
    () => createInitialSymptomPromptSession().answers,
  );

  const episodeIdRef = useRef(episodeId);
  const activeIndexRef = useRef(activeIndex);
  const answersRef = useRef(answers);
  const textPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const serverPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  /** Latest debounced free-text payload; cleared when the write runs or is flushed. */
  const pendingServerFreeTextPersistRef = useRef<{
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  } | null>(null);
  const userIdRef = useRef<string | null>(null);
  /** Bumps on each `load()` start and on effect cleanup so in-flight loads ignore stale results after unmount, retry, or param change. */
  const loadGenRef = useRef(0);
  /**
   * Monotonic id for `executeServerPersist` attempts; bumped on each new persist and on episode
   * change so out-of-order async completions do not clobber {@link persistError}. Episode id is
   * captured per attempt so flushes during navigation cannot attach errors to the wrong episode.
   */
  const serverPersistGenerationRef = useRef(0);
  const allowNavigationRef = useRef(false);

  const supabase = useMemo(() => createBrowserClient(), []);

  /**
   * Resolves the signed-in user id for RLS writes, caching on {@link userIdRef}.
   * Used by `load()` (before inputs enable) and as a fallback in {@link executeServerPersist}.
   */
  const resolveSessionUserId = useCallback(
    async (
      supabase: ReturnType<typeof createBrowserClient>,
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
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  const executeServerPersist = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      const targetEpisodeId = episodeIdRef.current;
      const generation = ++serverPersistGenerationRef.current;
      void (async () => {
        const uid = await resolveSessionUserId(supabase);
        if (generation !== serverPersistGenerationRef.current) {
          return;
        }
        if (!uid) {
          if (episodeIdRef.current === targetEpisodeId) {
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
        if (generation !== serverPersistGenerationRef.current) {
          return;
        }
        if (episodeIdRef.current !== targetEpisodeId) {
          return;
        }
        if (!r.ok) {
          setPersistError(r.error.message);
        } else {
          setPersistError(null);
        }
      })();
    },
    [resolveSessionUserId, supabase],
  );

  const executeServerDelete = useCallback(
    (line: PresetSymptomRow) => {
      const targetEpisodeId = episodeIdRef.current;
      const generation = ++serverPersistGenerationRef.current;
      void (async () => {
        const uid = await resolveSessionUserId(supabase);
        if (generation !== serverPersistGenerationRef.current) {
          return;
        }
        if (!uid) {
          if (episodeIdRef.current === targetEpisodeId) {
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
        if (generation !== serverPersistGenerationRef.current) {
          return;
        }
        if (episodeIdRef.current !== targetEpisodeId) {
          return;
        }
        if (!r.ok) {
          setPersistError(r.error.message);
        } else {
          setPersistError(null);
        }
      })();
    },
    [resolveSessionUserId, supabase],
  );

  /**
   * Clears the debounced server timer and immediately persists the latest free-text
   * payload (if any). Call before navigation / unmount so the last keystrokes are not lost.
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
   * Cancels any pending debounced free-text upsert and invalidates older in-flight persists.
   * Used before skip/delete so a delayed upsert cannot recreate a row after delete.
   */
  const cancelPendingServerPersist = useCallback(() => {
    if (serverPersistTimerRef.current !== null) {
      clearTimeout(serverPersistTimerRef.current);
      serverPersistTimerRef.current = null;
    }
    pendingServerFreeTextPersistRef.current = null;
    serverPersistGenerationRef.current += 1;
  }, []);

  const schedulePersistToSupabase = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
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
    [executeServerPersist],
  );

  useLayoutEffect(() => {
    const outgoingEpisodeId = episodeIdRef.current;
    if (textPersistTimerRef.current !== null) {
      clearTimeout(textPersistTimerRef.current);
      textPersistTimerRef.current = null;
      setSymptomPromptSession(outgoingEpisodeId, {
        activeIndex: activeIndexRef.current,
        answers: answersRef.current,
      });
    }
    serverPersistGenerationRef.current += 1;
    flushPendingServerPersist();
    episodeIdRef.current = episodeId;
    const s = getSymptomPromptSession(episodeId);
    setActiveIndex(s.activeIndex);
    setAnswers(s.answers);
    answersRef.current = s.answers;
    activeIndexRef.current = s.activeIndex;
    setPhase('prompting');
    setStatus('loading');
    setErrorMessage(null);
    setLines([]);
    setHydrated(true);
  }, [episodeId, symptomPresetId, flushPendingServerPersist]);

  const flushPendingTextPersist = useCallback(() => {
    if (textPersistTimerRef.current === null) {
      return;
    }
    clearTimeout(textPersistTimerRef.current);
    textPersistTimerRef.current = null;
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
  }, []);

  useEffect(() => {
    return () => {
      if (textPersistTimerRef.current === null) {
        return;
      }
      clearTimeout(textPersistTimerRef.current);
      textPersistTimerRef.current = null;
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: activeIndexRef.current,
        answers: answersRef.current,
      });
    };
  }, []);

  useEffect(() => {
    return () => {
      serverPersistGenerationRef.current += 1;
      flushPendingServerPersist();
    };
  }, [flushPendingServerPersist]);

  const persistImmediate = useCallback(
    (nextIndex: number, nextAnswers: typeof answers) => {
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: nextIndex,
        answers: nextAnswers,
      });
    },
    [],
  );

  const load = useCallback(async () => {
    const myGen = ++loadGenRef.current;
    const stale = () => myGen !== loadGenRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistError(null);
    setPhase('prompting');
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
    const result = await listPresetSymptomsForPreset(supabase, symptomPresetId);
    if (stale()) {
      return;
    }
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setStatus('error');
      return;
    }
    setLines(result.data);
    const fromServer = await listEpisodeSymptomsForEpisode(supabase, episodeId);
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
    setActiveIndex(idx);
    setAnswers(mergedAnswers);
    answersRef.current = mergedAnswers;
    activeIndexRef.current = idx;
    setSymptomPromptSession(episodeId, {
      activeIndex: idx,
      answers: mergedAnswers,
    });
    if (!fromServer.ok) {
      setPersistError(fromServer.error.message);
    }
    setStatus('ready');
  }, [episodeId, symptomPresetId, resolveSessionUserId, supabase]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

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
    if (!hydrated || phase !== 'prompting' || !currentLine) {
      return;
    }
    announce(`${stepLabel}. ${currentLine.symptom_name}.`, {
      politeness: 'polite',
    });
  }, [
    activeIndex,
    announce,
    currentLine,
    hydrated,
    lines.length,
    phase,
    stepLabel,
  ]);

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
    schedulePersistToSupabase(currentLine, next);

    if (next.type === 'free_text') {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
      }
      textPersistTimerRef.current = setTimeout(() => {
        textPersistTimerRef.current = null;
        setSymptomPromptSession(episodeIdRef.current, {
          activeIndex: activeIndexRef.current,
          answers: answersRef.current,
        });
      }, FREE_TEXT_PERSIST_DEBOUNCE_MS);
    } else {
      if (textPersistTimerRef.current !== null) {
        clearTimeout(textPersistTimerRef.current);
        textPersistTimerRef.current = null;
      }
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: activeIndexRef.current,
        answers: merged,
      });
    }
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
      persistImmediate(next, answersRef.current);
      return;
    }
    setPhase('complete');
    announce('Symptom list complete.', { politeness: 'polite' });
  };

  const goBackStep = () => {
    flushPendingTextPersist();
    flushPendingServerPersist();
    const idx = activeIndexRef.current;
    if (idx <= 0) {
      return;
    }
    const next = idx - 1;
    activeIndexRef.current = next;
    setActiveIndex(next);
    persistImmediate(next, answersRef.current);
    announce(`Back to step ${next + 1} of ${lines.length}.`, {
      politeness: 'polite',
    });
  };

  const confirmExitFlow = () => {
    const shouldExit = window.confirm(
      'Exit symptom flow? If you exit now, you will return home. Starting again creates a new episode.',
    );
    if (shouldExit) {
      router.push('/dashboard');
    } else {
      announce('Stayed on the current symptom step.', {
        politeness: 'polite',
      });
    }
  };

  useEffect(() => {
    if (phase !== 'prompting') {
      return;
    }
    const confirmMessage =
      'Exit symptom flow? If you exit now, you will return home. Starting again creates a new episode.';

    const onDocumentClick = (event: MouseEvent) => {
      if (allowNavigationRef.current) {
        return;
      }
      if (event.defaultPrevented) {
        return;
      }
      if (event.button !== 0) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return;
      }
      const target = event.target;
      if (!(target instanceof Element)) {
        return;
      }
      const anchor = target.closest('a[href]');
      if (!(anchor instanceof HTMLAnchorElement)) {
        return;
      }
      const rawHref = anchor.getAttribute('href');
      if (rawHref?.startsWith('#')) {
        return;
      }
      if (anchor.target && anchor.target !== '_self') {
        return;
      }
      if (anchor.hasAttribute('download')) {
        return;
      }
      const destination = new URL(anchor.href, window.location.href);
      const current = new URL(window.location.href);
      if (
        destination.origin === current.origin &&
        destination.pathname === current.pathname &&
        destination.search === current.search &&
        destination.hash !== current.hash
      ) {
        return;
      }
      if (destination.href === current.href) {
        return;
      }
      const shouldLeave = window.confirm(confirmMessage);
      if (!shouldLeave) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      flushPendingTextPersist();
      flushPendingServerPersist();
      allowNavigationRef.current = true;
    };

    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (allowNavigationRef.current) {
        return;
      }
      event.preventDefault();
      event.returnValue = '';
    };

    document.addEventListener('click', onDocumentClick, true);
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => {
      document.removeEventListener('click', onDocumentClick, true);
      window.removeEventListener('beforeunload', onBeforeUnload);
    };
  }, [flushPendingServerPersist, flushPendingTextPersist, phase]);

  const goNext = () => {
    flushPendingTextPersist();
    flushPendingServerPersist();
    advanceToNextStep();
  };

  const skipCurrentSymptom = () => {
    if (!currentLine) {
      return;
    }
    flushPendingTextPersist();
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
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: merged,
    });
    executeServerDelete(currentLine);
    announce(`Skipped ${currentLine.symptom_name}.`, { politeness: 'polite' });
    advanceToNextStep();
  };

  const onFinishToDashboard = () => {
    clearSymptomPromptSession(episodeId);
    router.push('/dashboard');
  };

  if (phase === 'complete') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
        <div
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm leading-relaxed text-app-ink">
            You reached the end of your symptom list for this episode. You can
            return to the dashboard when you are ready.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
          onClick={onFinishToDashboard}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (status === 'loading') {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
        <p className="text-sm text-app-muted" role="status">
          Loading symptom list…
        </p>
      </div>
    );
  }

  if (status === 'error' && errorMessage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
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

  return (
    <div className="space-y-6">
      <div>
        <p className="text-sm font-medium text-app-muted">
          <button
            type="button"
            onClick={confirmExitFlow}
            className="rounded-md text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none transition hover:text-app-ink hover:decoration-app-primary focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            ← Back to dashboard
          </button>
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
        {persistError ? (
          <p
            className="mt-2 text-sm text-amber-800 dark:text-amber-200"
            role="status"
          >
            Could not sync with the server: {persistError}
          </p>
        ) : null}
      </div>

      <p className="text-base font-medium text-app-muted">{stepLabel}</p>

      {lines.length === 0 ? (
        <div
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
          role="status"
        >
          <p className="text-sm leading-relaxed text-app-ink">
            This preset has no symptoms yet. You can add symptoms under
            Templates when you are not in an episode.
          </p>
        </div>
      ) : currentLine ? (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-app-ink">
            {currentLine.symptom_name}
          </h2>
          {currentLine.prompt_instruction ? (
            <p className="text-sm leading-relaxed text-app-muted">
              {currentLine.prompt_instruction}
            </p>
          ) : null}
          <SymptomPromptResponseField
            line={currentLine}
            answer={answers[currentLine.id]}
            onChange={onChangeAnswer}
            disabled={status !== 'ready'}
          />
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={activeIndex === 0}
          className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={goBackStep}
        >
          Back
        </button>
        {currentLine ? (
          <button
            type="button"
            disabled={!canSkipCurrentLine}
            className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
              canSkipCurrentLine
                ? 'hover:bg-app-surface/80'
                : 'cursor-not-allowed opacity-50'
            }`}
            onClick={skipCurrentSymptom}
          >
            Skip symptom
          </button>
        ) : null}
        <button
          type="button"
          disabled={!canProceedWithNext}
          className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl px-4 text-base font-semibold text-white shadow-md transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 ${
            canProceedWithNext
              ? 'bg-red-700 hover:bg-red-800 dark:hover:bg-red-500'
              : 'cursor-not-allowed bg-red-400 opacity-60 dark:bg-red-800'
          }`}
          onClick={goNext}
        >
          {lines.length === 0
            ? 'Done'
            : activeIndex >= lines.length - 1
              ? 'Finish'
              : 'Next'}
        </button>
      </div>
      <button
        type="button"
        className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-base font-medium text-app-muted transition hover:text-app-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        onClick={confirmExitFlow}
      >
        Exit symptom flow
      </button>
    </div>
  );
}
