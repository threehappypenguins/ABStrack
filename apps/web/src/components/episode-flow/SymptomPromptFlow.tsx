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
  computeSymptomResumePlacement,
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
  useUnsavedChangesLeaveGuard,
  type PendingLeaveAction,
} from '@/lib/use-unsaved-changes-leave-guard';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from '@/lib/episode-flow/symptom-prompt-session-store';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';
import { SymptomPromptResponseField } from './SymptomPromptResponseField';

export type SymptomPromptFlowProps = {
  /** `episodes.id` from the route. */
  episodeId: string;
  /** `symptom_presets.id` for the active episode (from template at start). */
  symptomPresetId: string;
  /**
   * When true (e.g. `?resume=1` from home), initial step follows merged server + session answers
   * instead of session index alone.
   */
  resumeFromEntry?: boolean;
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

/** Queue key so the same preset symptom id does not serialize writes across episodes. */
function lineWriteQueueKey(episodeId: string, presetSymptomId: string): string {
  return `${episodeId}:${presetSymptomId}`;
}

/**
 * No form in this flow uses this id; the shared leave guard requires a truthy `exemptFormId` to
 * register submit capture so non-exempt forms (all of them, here) are intercepted.
 */
const SYMPTOM_FLOW_LEAVE_GUARD_EXEMPT_FORM_ID =
  '__symptom_prompt_leave_guard_no_exempt__';

/**
 * Linear symptom stepper for the active episode’s preset (Week 5 skeleton).
 *
 * @param props - Episode and symptom preset identifiers.
 * @returns One symptom at a time with back/next and session-scoped progress.
 */
export function SymptomPromptFlow({
  episodeId,
  symptomPresetId,
  resumeFromEntry = false,
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
  /**
   * Per (episode, preset symptom) write queue so upsert/delete requests execute in user action
   * order within an episode only — not across `episodeId` changes while mounted.
   */
  const lineWriteQueueRef = useRef<Map<string, Promise<void>>>(new Map());
  const userIdRef = useRef<string | null>(null);
  /** Bumps on each `load()` start and on effect cleanup so in-flight loads ignore stale results after unmount, retry, or param change. */
  const loadGenRef = useRef(0);
  /**
   * Bumped only by {@link cancelPendingServerPersist}. Used with mount + episode id to gate
   * {@link setPersistError} only — upsert/delete for the captured `enqueueEpisodeId` always runs
   * so Supabase stays aligned when the user navigates or cancels debounced work.
   */
  const serverPersistEpochRef = useRef(0);
  /**
   * Increments on every enqueue of {@link executeServerPersist} / {@link executeServerDelete}.
   * Completions only call {@link setPersistError} when their captured id still equals this ref so
   * out-of-order finishes across lines cannot clear a newer failure (or show stale errors).
   */
  const persistUiAttemptRef = useRef(0);
  /** Suppresses {@link setPersistError} after unmount (epoch is not bumped on unmount). */
  const isMountedRef = useRef(true);

  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const pendingLeaveRef = useRef<PendingLeaveAction | null>(null);
  /**
   * When `episodeId` / `symptomPresetId` change, the layout reset syncs this to `resumeFromEntry` so a
   * new episode is not stuck in “resume from home” after visiting with `?resume=1` earlier.
   * While the route is unchanged, `resumeFromEntry` may become true later, or the URL may strip
   * `resume` after load — the render latch below keeps intent stable for that case.
   */
  const resumeFromHomeIntentRef = useRef(!!resumeFromEntry);
  if (resumeFromEntry) {
    resumeFromHomeIntentRef.current = true;
  }

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

  /** Keep refs aligned before paint so exit / unmount persist cannot read a stale step after Next. */
  useLayoutEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useLayoutEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const executeServerPersist = useCallback(
    (line: PresetSymptomRow, answer: SymptomPromptAnswer) => {
      /** Captured at enqueue so queued work cannot attach to a later episode after route change. */
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
          // Epoch/mount/episode/attempt gate UI only — the upsert above always ran for `targetEpisodeId`.
          if (
            isMountedRef.current &&
            episodeIdRef.current === enqueueEpisodeId &&
            enqueueEpoch === serverPersistEpochRef.current &&
            attemptId === persistUiAttemptRef.current
          ) {
            if (!r.ok) {
              setPersistError(r.error.message);
            } else {
              setPersistError(null);
            }
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
    },
    [resolveSessionUserId, supabase],
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
          // Epoch/mount/episode/attempt gate UI only — the delete above always ran for `targetEpisodeId`.
          if (
            isMountedRef.current &&
            episodeIdRef.current === enqueueEpisodeId &&
            enqueueEpoch === serverPersistEpochRef.current &&
            attemptId === persistUiAttemptRef.current
          ) {
            if (!r.ok) {
              setPersistError(r.error.message);
            } else {
              setPersistError(null);
            }
          }
        });
      queues.set(queueKey, next);
      void next.finally(() => {
        if (queues.get(queueKey) === next) {
          queues.delete(queueKey);
        }
      });
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
    serverPersistEpochRef.current += 1;
  }, []);

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
    flushPendingServerPersist();
    resumeFromHomeIntentRef.current = !!resumeFromEntry;
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

  const onRequestDiscardDialog = useCallback(() => {
    setDiscardDialogOpen(true);
  }, []);

  const handleDiscardConfirm = useCallback(() => {
    flushPendingTextPersist();
    flushPendingServerPersist();
    setSymptomPromptSession(episodeIdRef.current, {
      activeIndex: activeIndexRef.current,
      answers: answersRef.current,
    });
    const action = pendingLeaveRef.current;
    pendingLeaveRef.current = null;

    if (!action) {
      router.push('/dashboard');
      return;
    }
    if (action.kind === 'form') {
      action.form.submit();
      return;
    }
    const { href } = action;
    let url: URL;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      router.push('/dashboard');
      return;
    }
    if (url.origin !== window.location.origin) {
      window.location.assign(href);
      return;
    }
    router.push(`${url.pathname}${url.search}${url.hash}`);
  }, [flushPendingServerPersist, flushPendingTextPersist, router]);

  useUnsavedChangesLeaveGuard({
    active: phase === 'prompting' && status === 'ready',
    dialogOpen: discardDialogOpen,
    pendingLeaveRef,
    onRequestDiscard: onRequestDiscardDialog,
    exemptFormId: SYMPTOM_FLOW_LEAVE_GUARD_EXEMPT_FORM_ID,
  });

  useEffect(() => {
    return () => {
      flushPendingTextPersist();
      flushPendingServerPersist();
      setSymptomPromptSession(episodeIdRef.current, {
        activeIndex: activeIndexRef.current,
        answers: answersRef.current,
      });
    };
  }, [flushPendingServerPersist, flushPendingTextPersist]);

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
    let idx: number;
    let initialPhase: 'prompting' | 'complete' = 'prompting';
    const treatAsResumeFromHome = resumeFromHomeIntentRef.current;
    if (treatAsResumeFromHome) {
      const placement = computeSymptomResumePlacement(
        result.data,
        mergedAnswers,
      );
      if (placement.phase === 'complete') {
        idx = placement.activeIndex;
        initialPhase = 'complete';
      } else {
        const sIdx = clampIndex(session.activeIndex, result.data.length);
        const pIdx = placement.activeIndex;
        // `session.activeIndex` can be 0 if persist ran before refs caught up with Next (fixed via
        // useLayoutEffect). `placement` is first unanswered from merged server + session answers.
        // Max covers stale 0 + answered first line → land on the second symptom as expected.
        idx = clampIndex(Math.max(sIdx, pIdx), result.data.length);
        initialPhase = 'prompting';
      }
    } else {
      idx = clampIndex(session.activeIndex, result.data.length);
    }
    setActiveIndex(idx);
    setAnswers(mergedAnswers);
    answersRef.current = mergedAnswers;
    activeIndexRef.current = idx;
    setPhase(initialPhase);
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

  useEffect(() => {
    if (!resumeFromEntry || status !== 'ready') {
      return;
    }
    if (typeof window === 'undefined') {
      return;
    }
    const url = new URL(window.location.href);
    if (!url.searchParams.has('resume')) {
      return;
    }
    url.searchParams.delete('resume');
    router.replace(`${url.pathname}${url.search}${url.hash}`);
  }, [resumeFromEntry, router, status]);

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

  const confirmExitFlow = useCallback(() => {
    pendingLeaveRef.current = { kind: 'href', href: '/dashboard' };
    setDiscardDialogOpen(true);
  }, []);

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
    <>
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
          {activeIndex > 0 ? (
            <button
              type="button"
              className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={goBackStep}
            >
              Back
            </button>
          ) : null}
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

      <ConfirmDialog
        open={discardDialogOpen}
        title="Exit symptom flow?"
        description="If you exit now, you will return to the dashboard. This episode stays open, your progress is saved, and you can resume from home when you are ready."
        confirmLabel="Exit"
        cancelLabel="Stay"
        onConfirm={() => {
          handleDiscardConfirm();
        }}
        onClose={() => {
          pendingLeaveRef.current = null;
          setDiscardDialogOpen(false);
        }}
      />
    </>
  );
}
