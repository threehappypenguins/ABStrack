import { PageLoading } from '@/components/page-states/PageLoading';

/**
 * Route-level loading UI for the episode-start shell.
 *
 * @returns Loading fallback.
 */
export default function EpisodeStartLoading() {
  return <PageLoading title="Start an episode" />;
}
