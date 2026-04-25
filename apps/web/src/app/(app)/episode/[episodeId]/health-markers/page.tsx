import { HealthMarkerPromptFlow } from '@/components/episode-flow/HealthMarkerPromptFlow';

type PageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ episodeId: string }>;
  searchParams: Promise<{ resume?: string; hub?: string }>;
};

/**
 * In-episode linear health marker prompts for the episode's linked marker preset.
 *
 * @param props - Route and query params.
 * @returns Marker prompt flow.
 */
export default async function EpisodeHealthMarkersPage({
  params,
  searchParams,
}: PageProps) {
  const { episodeId } = await params;
  const { resume, hub } = await searchParams;
  const resumeFromEntry =
    resume === '1' || resume === 'true' || resume === 'yes';
  const resumeToEpisodeHub =
    resumeFromEntry && (hub === '1' || hub === 'true' || hub === 'yes');

  return (
    <HealthMarkerPromptFlow
      episodeId={episodeId}
      resumeFromEntry={resumeFromEntry}
      resumeToEpisodeHub={resumeToEpisodeHub}
    />
  );
}
