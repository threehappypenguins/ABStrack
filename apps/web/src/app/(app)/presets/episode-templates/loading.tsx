import { PageLoading } from '@/components/page-states/PageLoading';

/**
 * Route-level loading UI for episode templates.
 *
 * @returns Loading fallback.
 */
export default function EpisodeTemplatesLoading() {
  return <PageLoading title="Episode templates" />;
}
