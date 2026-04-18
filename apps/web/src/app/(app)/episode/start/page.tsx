import Link from 'next/link';

/**
 * Episode-start flow shell: entry route after the home CTA. Template selection and prompts are
 * implemented in follow-up work.
 *
 * @returns Episode start placeholder within the authenticated shell.
 */
export default function EpisodeStartPage() {
  return (
    <div className="w-full space-y-8">
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
          Start an episode
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-app-muted">
          You are in the episode logging flow. Choosing an episode template and
          stepping through prompts will be added here in follow-up work.
        </p>
      </div>

      <div
        className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm leading-relaxed text-app-ink">
          This screen confirms you reached the episode-start pathway from home.
          Template selection and symptom prompts are not implemented on this
          page yet.
        </p>
      </div>
    </div>
  );
}
