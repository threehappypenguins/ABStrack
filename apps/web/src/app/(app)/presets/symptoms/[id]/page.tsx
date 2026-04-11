import { SymptomPresetEditorPage } from '@/components/symptom-presets/SymptomPresetEditorPage';

type PageProps = {
  params: { id: string };
};

/**
 * Edit one symptom preset: lines, response types, reorder.
 *
 * @param props - Next.js route params.
 * @returns Editor route content.
 */
export default function SymptomPresetDetailPage({ params }: PageProps) {
  return <SymptomPresetEditorPage presetId={params.id} />;
}
