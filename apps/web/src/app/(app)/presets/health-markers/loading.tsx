import { PageLoading } from '@/components/page-states/PageLoading';

/**
 * Route-level loading UI for health marker presets.
 *
 * @returns Loading fallback.
 */
export default function HealthMarkerPresetsLoading() {
  return <PageLoading title="Health marker presets" />;
}
