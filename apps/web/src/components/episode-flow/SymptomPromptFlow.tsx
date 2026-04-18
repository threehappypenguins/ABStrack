'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  PresetSymptomRow,
  SymptomPromptAnswer,
  SymptomPromptAnswers,
} from '@abstrack/types';
import { createInitialSymptomPromptSession } from '@abstrack/types';
import { listPresetSymptomsForPreset } from '@abstrack/supabase';
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

  useEffect(() => {
    activeIndexRef.current = activeIndex;
  }, [activeIndex]);

  useEffect(() => {
    answersRef.current = answers;
  }, [answers]);

  useEffect(() => {
    const outgoingEpisodeId = episodeIdRef.current;
    if (textPersistTimerRef.current !== null) {
      clearTimeout(textPersistTimerRef.current);
      textPersistTimerRef.current = null;
      setSymptomPromptSession(outgoingEpisodeId, {
        activeIndex: activeIndexRef.current,
        answers: answersRef.current,
      });
    }
    episodeIdRef.current = episodeId;
    const s = getSymptomPromptSession(episodeId);
    setActiveIndex(s.activeIndex);
    setAnswers(s.answers);
    answersRef.current = s.answers;
    activeIndexRef.current = s.activeIndex;
    setPhase('prompting');
    setHydrated(true);
  }, [episodeId]);

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
    setStatus('loading');
    setErrorMessage(null);
    const supabase = createBrowserClient();
    const result = await listPresetSymptomsForPreset(supabase, symptomPresetId);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setStatus('error');
      return;
    }
    setLines(result.data);
    const session = getSymptomPromptSession(episodeId);
    const idx = clampIndex(session.activeIndex, result.data.length);
    setActiveIndex(idx);
    setAnswers(session.answers);
    answersRef.current = session.answers;
    activeIndexRef.current = idx;
    setSymptomPromptSession(episodeId, {
      activeIndex: idx,
      answers: session.answers,
    });
    setStatus('ready');
  }, [episodeId, symptomPresetId]);

  useEffect(() => {
    void load();
  }, [load]);

  const currentLine = lines[activeIndex] ?? null;
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

  const goBackStep = () => {
    flushPendingTextPersist();
    if (activeIndex > 0) {
      const next = activeIndex - 1;
      setActiveIndex(next);
      activeIndexRef.current = next;
      persistImmediate(next, answersRef.current);
      announce(`Back to step ${next + 1} of ${lines.length}.`, {
        politeness: 'polite',
      });
    } else {
      router.push('/dashboard');
    }
  };

  const goNext = () => {
    flushPendingTextPersist();
    if (lines.length === 0) {
      setPhase('complete');
      return;
    }
    if (activeIndex < lines.length - 1) {
      const next = activeIndex + 1;
      setActiveIndex(next);
      activeIndexRef.current = next;
      persistImmediate(next, answersRef.current);
      return;
    }
    setPhase('complete');
    announce('Symptom list complete.', { politeness: 'polite' });
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
          <Link
            href="/dashboard"
            className="rounded-md text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none transition hover:text-app-ink hover:decoration-app-primary focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            ← Back to dashboard
          </Link>
        </p>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
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
          className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={goBackStep}
        >
          {activeIndex === 0 ? 'Exit to dashboard' : 'Back'}
        </button>
        <button
          type="button"
          className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl bg-red-700 px-4 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
          onClick={goNext}
        >
          {lines.length === 0
            ? 'Done'
            : activeIndex >= lines.length - 1
              ? 'Finish'
              : 'Next'}
        </button>
      </div>
    </div>
  );
}
