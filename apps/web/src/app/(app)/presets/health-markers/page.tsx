import { PageEmpty } from '@/components/page-states/PageEmpty';

/**
 * Health marker presets landing route. CRUD and Supabase wiring are out of scope for this shell.
 *
 * @returns Placeholder empty state.
 */
export default function HealthMarkerPresetsPage() {
  return (
    <PageEmpty
      title="Health marker presets"
      description="You have not created any health marker presets yet. When this feature is connected, you will configure the markers you track alongside episodes."
    />
  );
}
