import { HealthMarkerPresetCreateForm } from '@/components/health-marker-presets/HealthMarkerPresetCreateForm';

/**
 * Create a new health marker preset (header only), then continue to the editor.
 *
 * @returns Create route content.
 */
export default function NewHealthMarkerPresetPage() {
  return <HealthMarkerPresetCreateForm />;
}
