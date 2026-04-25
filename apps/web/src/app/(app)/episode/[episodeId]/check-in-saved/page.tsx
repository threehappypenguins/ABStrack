import { redirect } from 'next/navigation';
import { HealthMarkerPromptFlow } from '@/components/episode-flow/HealthMarkerPromptFlow';
import { createServerClient } from '@/lib/supabase/server-client';

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
  const supabase = await createServerClient();
  const { data: episode, error } = await supabase
    .from('episodes')
    .select('id,post_marker_step_completed_at')
    .eq('id', episodeId)
    .maybeSingle();

  if (error || !episode) {
    redirect('/dashboard');
  }

  if (!episode.post_marker_step_completed_at) {
    redirect(`/episode/${episodeId}/health-markers?resume=1`);
  }

  return (
    <HealthMarkerPromptFlow
      episodeId={episodeId}
      resumeFromEntry
      resumeToEpisodeHub
    />
  );
}
