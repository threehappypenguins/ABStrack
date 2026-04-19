import Link from 'next/link';
import { SymptomPromptFlow } from '@/components/episode-flow/SymptomPromptFlow';

type PageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ episodeId: string }>;
  searchParams: Promise<{ symptomPresetId?: string }>;
};

/**
 * In-episode linear symptom prompts for the selected preset (Week 5 skeleton).
 *
 * @param props - Route and query params (`symptomPresetId` is required for this flow).
 * @returns Symptom stepper or guidance when params are missing.
 */
export default async function EpisodeSymptomsPage({
  params,
  searchParams,
}: PageProps) {
  const { episodeId } = await params;
  const { symptomPresetId } = await searchParams;

  if (!symptomPresetId) {
    return (
      <div className="space-y-4">
        <p className="text-sm font-medium text-app-muted">
          <Link
            href="/dashboard"
            className="rounded-md text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none transition hover:text-app-ink focus-visible:ring-2 focus-visible:ring-app-ring"
          >
            ← Back to dashboard
          </Link>
        </p>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode symptoms
        </h1>
        <p className="text-sm text-app-muted" role="status">
          This page needs a symptom preset reference. Start an episode from the
          dashboard and try again.
        </p>
      </div>
    );
  }

  return (
    <SymptomPromptFlow
      episodeId={episodeId}
      symptomPresetId={symptomPresetId}
    />
  );
}
