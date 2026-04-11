import { SymptomPresetCreateForm } from '@/components/symptom-presets/SymptomPresetCreateForm';

/**
 * Create a new symptom preset (header only), then continue to the editor.
 *
 * @returns Create route content.
 */
export default function NewSymptomPresetPage() {
  return <SymptomPresetCreateForm />;
}
