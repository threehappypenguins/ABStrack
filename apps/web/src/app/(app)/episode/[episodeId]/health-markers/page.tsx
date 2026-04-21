import { HealthMarkerPromptFlow } from '@/components/episode-flow/HealthMarkerPromptFlow';

type PageProps = {
  params: { episodeId: string };
  searchParams: { resume?: string };
};

/**
 * In-episode linear health marker prompts for the episode's linked marker preset.
 *
 * @param props - Route and query params.
 * @returns Marker prompt flow.
 */
export default function EpisodeHealthMarkersPage({
  params,
  searchParams,
}: PageProps) {
  const { episodeId } = params;
  const { resume } = searchParams;
  const resumeFromEntry =
    resume === '1' || resume === 'true' || resume === 'yes';

  return (
    <HealthMarkerPromptFlow
      episodeId={episodeId}
      resumeFromEntry={resumeFromEntry}
    />
  );
}
