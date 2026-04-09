import { Week4PageEmpty } from '@/components/week4/PageStates';

/**
 * Symptom presets landing route (Week 4). CRUD and Supabase wiring are out of scope for this shell.
 *
 * @returns Placeholder empty state.
 */
export default function SymptomPresetsPage() {
  return (
    <Week4PageEmpty
      title="Symptom presets"
      description="You have not created any symptom presets yet. When this feature is connected, you will define named lists of symptoms and response types for episode logging."
    />
  );
}
