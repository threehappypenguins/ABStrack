import { PageLoading } from '@/components/page-states/PageLoading';

/**
 * Route-level loading UI for symptom presets.
 *
 * @returns Loading fallback.
 */
export default function SymptomPresetsLoading() {
  return <PageLoading title="Symptom presets" />;
}
