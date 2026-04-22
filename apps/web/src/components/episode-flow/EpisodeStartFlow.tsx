'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import type {
  EpisodeRow,
  EpisodeTemplateWithPresetsRow,
} from '@abstrack/types';
import {
  createEpisode,
  endEpisodeIfStillActive,
  getActiveEpisodeForUser,
  listEpisodeTemplates,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { buildResumeEpisodeHref } from '@/lib/episode-flow/resume-episode-href';
import { clearSymptomPromptSession } from '@/lib/episode-flow/symptom-prompt-session-store';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';
import { PageLoading } from '@/components/page-states/PageLoading';

/**
 * Impaired-friendly episode start: load templates; if there is exactly one template, create the
 * episode immediately. Otherwise require one selection, then insert an episode row with both
 * linked preset ids.
 *
 * @returns Client UI for `/episode/start`.
 */
export function EpisodeStartFlow() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();
  const groupLegendId = useId();
  /** Prevents concurrent or repeated `createEpisode` on the single-template auto-start path when `refresh` runs more than once before navigation. */
  const singleTemplateAutoInFlightRef = useRef(false);
  const singleTemplateAutoSucceededRef = useRef(false);

  const [rows, setRows] = useState<EpisodeTemplateWithPresetsRow[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>(
    'loading',
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  /** Open episode (`ended_at` null) — blocks starting another until resume or explicit end. */
  const [blockingActiveEpisode, setBlockingActiveEpisode] =
    useState<EpisodeRow | null>(null);
  const [resolvingActiveBlock, setResolvingActiveBlock] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    const userId = session?.user?.id;
    if (!userId) {
      return;
    }
    const supabase = createBrowserClient();
    setLoadState('loading');
    setLoadError(null);
    setSubmitError(null);
    setBlockingActiveEpisode(null);

    const activeResult = await getActiveEpisodeForUser(supabase, userId);
    if (!activeResult.ok) {
      setLoadState('error');
      setLoadError(activeResult.error.message);
      return;
    }
    if (activeResult.data) {
      setBlockingActiveEpisode(activeResult.data);
      setLoadState('idle');
      return;
    }

    const result = await listEpisodeTemplates(supabase);
    if (!result.ok) {
      setLoadState('error');
      setLoadError(result.error.message);
      return;
    }
    setRows(result.data);

    if (result.data.length === 1) {
      if (singleTemplateAutoSucceededRef.current) {
        // Stay on `loading` until `router.replace` unmounts — `idle` would flash the chooser (e.g. Strict Mode re-runs).
        return;
      }
      if (singleTemplateAutoInFlightRef.current) {
        setLoadState('loading');
        return;
      }

      const template = result.data[0];
      singleTemplateAutoInFlightRef.current = true;
      setSubmitting(true);
      let didNavigateToSymptoms = false;
      try {
        const saveResult = await createEpisode(supabase, {
          user_id: userId,
          started_at: new Date().toISOString(),
          symptom_preset_id: template.symptom_preset_id,
          health_marker_preset_id: template.health_marker_preset_id,
        });
        if (!saveResult.ok) {
          setSelectedId(template.id);
          setSubmitError(saveResult.error.message);
          announce(saveResult.error.message, { politeness: 'assertive' });
          setLoadState('idle');
          return;
        }
        singleTemplateAutoSucceededRef.current = true;
        announce('Episode started.', { politeness: 'polite' });
        // Stay on `loading` until navigation unmounts this view — `idle` would paint the chooser for a frame.
        router.replace(
          `/episode/${saveResult.data.id}/symptoms?symptomPresetId=${encodeURIComponent(template.symptom_preset_id)}`,
        );
        didNavigateToSymptoms = true;
      } finally {
        singleTemplateAutoInFlightRef.current = false;
        if (!didNavigateToSymptoms) {
          setSubmitting(false);
        }
      }
      return;
    }

    setLoadState('idle');
    setSelectedId((prev) => {
      if (prev && result.data.some((r) => r.id === prev)) {
        return prev;
      }
      return null;
    });
  }, [announce, router, session?.user?.id]);

  useEffect(() => {
    if (authLoading || !session?.user?.id) {
      return;
    }
    void refresh();
  }, [authLoading, session?.user?.id, refresh]);

  const onEndActiveEpisodeAndStartNew = useCallback(async (): Promise<void> => {
    if (!session?.user?.id || !blockingActiveEpisode || resolvingActiveBlock) {
      return;
    }
    setResolvingActiveBlock(true);
    setSubmitError(null);
    try {
      const supabase = createBrowserClient();
      const end = await endEpisodeIfStillActive(
        supabase,
        blockingActiveEpisode.id,
        new Date().toISOString(),
        blockingActiveEpisode.started_at,
      );
      if (!end.ok) {
        setSubmitError(end.error.message);
        announce(end.error.message, { politeness: 'assertive' });
        return;
      }
      clearSymptomPromptSession(blockingActiveEpisode.id);
      await refresh();
      if (!end.data.didEnd) {
        return;
      }
      const verify = await getActiveEpisodeForUser(supabase, session.user.id);
      if (!verify.ok) {
        setSubmitError(verify.error.message);
        return;
      }
      if (!verify.data) {
        announce('Previous episode closed. You can start a new one.', {
          politeness: 'polite',
        });
      } else {
        setSubmitError(
          'We could not confirm your previous episode is closed. Try Continue this episode or try again.',
        );
      }
    } finally {
      setResolvingActiveBlock(false);
    }
  }, [
    announce,
    blockingActiveEpisode,
    refresh,
    resolvingActiveBlock,
    session?.user?.id,
  ]);

  const onSubmit = async (): Promise<void> => {
    if (!session?.user?.id || selectedId === null || submitting) {
      return;
    }
    const template = rows.find((r) => r.id === selectedId);
    if (!template) {
      return;
    }
    setSubmitting(true);
    setSubmitError(null);
    let didNavigateToSymptoms = false;
    try {
      const supabase = createBrowserClient();
      const result = await createEpisode(supabase, {
        user_id: session.user.id,
        started_at: new Date().toISOString(),
        symptom_preset_id: template.symptom_preset_id,
        health_marker_preset_id: template.health_marker_preset_id,
      });
      if (!result.ok) {
        setSubmitError(result.error.message);
        announce(result.error.message, { politeness: 'assertive' });
        return;
      }
      announce('Episode started.', { politeness: 'polite' });
      router.replace(
        `/episode/${result.data.id}/symptoms?symptomPresetId=${encodeURIComponent(template.symptom_preset_id)}`,
      );
      didNavigateToSymptoms = true;
    } finally {
      if (!didNavigateToSymptoms) {
        setSubmitting(false);
      }
    }
  };

  if (authLoading) {
    return <PageLoading title="Start an episode" />;
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Start an episode
        </h1>
        <p className="text-sm text-app-muted" role="status">
          You need to be signed in to start an episode.
        </p>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (blockingActiveEpisode) {
    const presetId = blockingActiveEpisode.symptom_preset_id;
    const isAtEndStep =
      blockingActiveEpisode.post_marker_step_completed_at != null;
    const canResume =
      isAtEndStep || (typeof presetId === 'string' && presetId.length > 0);
    const gateStatusId = `episode-start-active-gate-status${groupLegendId}`;
    const primaryLinkClass =
      'inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 py-4 text-center text-base font-semibold leading-snug text-white shadow-md outline-none ring-2 ring-transparent transition hover:bg-red-800 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-red-50 dark:bg-red-600 dark:hover:bg-red-500 dark:focus-visible:ring-offset-red-950';
    const secondaryButtonClass =
      'inline-flex min-h-[56px] w-full items-center justify-center rounded-xl border-2 border-app-border bg-app-surface px-5 py-4 text-center text-base font-semibold leading-snug text-app-ink shadow-sm outline-none transition hover:bg-app-surface/80 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-50 dark:border-neutral-600 dark:bg-neutral-900/60';

    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Episode already in progress
          </h1>
          <p className="mt-2 text-base leading-relaxed text-app-ink">
            You already have one episode open that is not finished. Only one
            episode can be open at a time. Choose what to do next.
          </p>
          {!canResume ? (
            <p className="mt-3 text-sm leading-relaxed text-app-muted">
              This episode is missing preset data, so it cannot be resumed. End
              this episode to start a new one.
            </p>
          ) : null}
        </div>
        <p
          id={gateStatusId}
          className="sr-only"
          role="status"
          aria-live="polite"
        >
          {canResume
            ? 'An unfinished episode is already open. Actions: Continue this episode, or End this episode and start a new one.'
            : 'An unfinished episode is already open. Preset data is missing, so you cannot continue. Action: End this episode and start a new one.'}
        </p>
        {submitError ? (
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {submitError}
          </p>
        ) : null}
        <div className="flex flex-col gap-3 sm:max-w-md">
          {canResume ? (
            <Link
              href={buildResumeEpisodeHref(blockingActiveEpisode.id, presetId, {
                toHealthMarkers: isAtEndStep,
              })}
              className={primaryLinkClass}
              aria-describedby={gateStatusId}
            >
              Continue this episode
            </Link>
          ) : null}
          <button
            type="button"
            className={canResume ? secondaryButtonClass : primaryLinkClass}
            disabled={resolvingActiveBlock}
            aria-describedby={gateStatusId}
            onClick={() => {
              void onEndActiveEpisodeAndStartNew();
            }}
          >
            {resolvingActiveBlock
              ? 'Closing episode…'
              : 'End this episode and start a new one'}
          </button>
        </div>
      </div>
    );
  }

  if (loadState === 'loading') {
    return (
      <PageLoading
        title="Start an episode"
        message={submitting ? 'Starting your episode…' : 'Preparing…'}
      />
    );
  }

  if (loadState === 'error' && loadError) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Start an episode
        </h1>
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {loadError}
        </p>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => {
            void refresh();
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
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Start an episode
        </h1>
        {rows.length === 0 ? null : (
          <p className="mt-2 text-sm leading-relaxed text-app-muted">
            {rows.length === 1
              ? 'Your episode uses the template below for symptoms and health markers.'
              : 'Choose the episode template that matches what you want to log. One template applies to this episode.'}
          </p>
        )}
      </div>

      {rows.length === 0 ? (
        <div
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm leading-relaxed text-app-ink">
            You do not have any episode templates yet. Create a template under{' '}
            <Link
              href="/presets/episode-templates"
              className="font-medium text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none hover:text-app-ink focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              Episode templates
            </Link>{' '}
            before starting an episode.
          </p>
        </div>
      ) : (
        <fieldset className="space-y-4 border-0 p-0">
          <legend
            id={groupLegendId}
            className="text-base font-semibold text-app-ink"
          >
            {rows.length === 1 ? 'Your template' : 'Choose one template'}
          </legend>
          <div
            className="space-y-3"
            role="radiogroup"
            aria-labelledby={groupLegendId}
          >
            {rows.map((row) => {
              const inputId = `episode-start-template-${row.id}`;
              const selected = selectedId === row.id;
              return (
                <label
                  key={row.id}
                  htmlFor={inputId}
                  className={`flex cursor-pointer flex-col gap-1 rounded-2xl border-2 p-4 transition sm:p-5 ${
                    selected
                      ? 'border-app-primary bg-app-primary/5 ring-1 ring-app-primary/20'
                      : 'border-app-border/90 bg-app-surface hover:border-app-border'
                  }`}
                >
                  <span className="flex items-start gap-3">
                    <input
                      id={inputId}
                      className="mt-1 h-4 w-4 shrink-0 border-app-border text-app-primary focus:ring-app-ring"
                      type="radio"
                      name="episode-template"
                      value={row.id}
                      checked={selected}
                      onChange={() => {
                        setSelectedId(row.id);
                        setSubmitError(null);
                      }}
                      disabled={submitting}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block text-base font-semibold text-app-ink">
                        {row.name}
                      </span>
                      <span className="mt-1 block text-sm text-app-muted">
                        Symptoms: {row.symptom_preset.name}. Markers:{' '}
                        {row.health_marker_preset.name}.
                      </span>
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      {submitError ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {submitError}
        </p>
      ) : null}

      {rows.length > 0 ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
          <button
            type="button"
            className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-50 dark:bg-red-600 dark:hover:bg-red-500 sm:w-auto sm:min-w-[220px]"
            disabled={selectedId === null || submitting}
            onClick={() => {
              void onSubmit();
            }}
          >
            {submitting ? 'Starting…' : 'Start episode'}
          </button>
        </div>
      ) : null}
    </div>
  );
}
