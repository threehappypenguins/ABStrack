'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { cancelActiveEpisodeById } from '@abstrack/supabase';
import type { EpisodeRow } from '@abstrack/types';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { buildResumeEpisodeHref } from '@/lib/episode-flow/resume-episode-href';
import { clearSymptomPromptSession } from '@/lib/episode-flow/symptom-prompt-session-store';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { formatEpisodeTypeSummary } from '@/lib/episodes/format-episode-meta';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';
import { EpisodeLocaleInstant } from './EpisodeLocaleInstant';

const resumeLinkClass =
  'inline-flex min-h-[48px] w-full items-center justify-center rounded-xl bg-emerald-700 px-4 py-3 text-center text-sm font-semibold text-white shadow-sm outline-none ring-2 ring-transparent transition hover:bg-emerald-800 focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-emerald-50 dark:bg-emerald-600 dark:hover:bg-emerald-500 dark:focus-visible:ring-offset-emerald-950';

/**
 * Active-episode management card with resume and destructive cancel action.
 *
 * @param props - Active episode row.
 * @returns Interactive card for an in-progress episode.
 */
export function ActiveEpisodeCard({ episode }: { episode: EpisodeRow }) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const [showCancelDialog, setShowCancelDialog] = useState(false);
  const [canceling, setCanceling] = useState(false);

  const handleConfirmCancel = async (): Promise<void | false> => {
    if (canceling) {
      return false;
    }
    setCanceling(true);
    try {
      const supabase = createBrowserClient();
      const result = await cancelActiveEpisodeById(supabase, episode.id);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      clearSymptomPromptSession(episode.id);
      if (result.data.didCancel) {
        announce('Episode canceled. Resume is no longer available.', {
          politeness: 'polite',
        });
      } else {
        announce('This episode is no longer active.', { politeness: 'polite' });
      }
      router.refresh();
      return;
    } finally {
      setCanceling(false);
    }
  };

  return (
    <>
      <div
        className="mt-3 rounded-2xl border-2 border-emerald-600/45 bg-emerald-50 p-5 shadow-sm ring-1 ring-emerald-900/10 dark:border-emerald-500/45 dark:bg-emerald-950/40 dark:ring-emerald-950/35 sm:p-6"
        aria-label="Active episode"
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-emerald-800 dark:text-emerald-200">
          In progress
        </p>
        <p className="mt-2 text-base font-semibold text-app-ink">
          {formatEpisodeTypeSummary(episode)}
        </p>
        <dl className="mt-3 space-y-1.5 text-sm text-app-muted">
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-app-ink/80">Started</dt>
            <dd>
              <EpisodeLocaleInstant iso={episode.started_at} />
            </dd>
          </div>
          <div className="flex flex-wrap gap-x-2">
            <dt className="font-medium text-app-ink/80">Ended</dt>
            <dd>—</dd>
          </div>
        </dl>
        <div className="mt-5 space-y-3">
          {episode.symptom_preset_id ? (
            <Link
              href={buildResumeEpisodeHref(
                episode.id,
                episode.symptom_preset_id,
              )}
              className={resumeLinkClass}
            >
              Resume this episode
            </Link>
          ) : (
            <p className="text-sm text-app-muted">
              This episode has no symptom preset linked yet.{' '}
              <Link
                href="/episode/start"
                className="font-semibold text-app-primary underline underline-offset-2"
              >
                Open episode start
              </Link>{' '}
              to continue setup.
            </p>
          )}
          <button
            type="button"
            className="inline-flex min-h-[44px] w-full items-center justify-center rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-sm font-semibold text-red-800 shadow-sm transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-red-50 dark:border-red-800/80 dark:bg-red-950/30 dark:text-red-200 dark:hover:bg-red-950/45"
            onClick={() => {
              setShowCancelDialog(true);
            }}
            disabled={canceling}
          >
            Cancel episode
          </button>
        </div>
      </div>
      <ConfirmDialog
        open={showCancelDialog}
        title="Cancel this active episode?"
        description="Canceling will permanently remove this in-progress episode and any linked symptom or media entries. This cannot be undone."
        confirmLabel="Cancel episode"
        cancelLabel="Keep episode"
        confirmBusyLabel="Canceling episode…"
        onConfirm={handleConfirmCancel}
        onClose={() => {
          setShowCancelDialog(false);
        }}
      />
    </>
  );
}
