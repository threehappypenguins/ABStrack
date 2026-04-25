import { HealthMarkerPromptFlow } from '@/components/episode-flow/HealthMarkerPromptFlow';

type PageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ episodeId: string }>;
};

/**
 * Episode check-in completion hub (after Save and continue).
 *
 * @param props - Route params.
 * @returns Check-in saved actions + recent timeline.
 */
export default async function EpisodeCheckInSavedPage({ params }: PageProps) {
  const { episodeId } = await params;
  return (
    <HealthMarkerPromptFlow
      episodeId={episodeId}
      resumeFromEntry
      resumeToEpisodeHub
    />
  );
}
