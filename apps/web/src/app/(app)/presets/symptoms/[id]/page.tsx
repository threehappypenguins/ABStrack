import { SymptomPresetEditorPage } from '@/components/symptom-presets/SymptomPresetEditorPage';

type PageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ id: string }>;
};

/**
 * Edit one symptom preset: lines, response types, reorder.
 *
 * @param props - Next.js route params.
 * @returns Editor route content.
 */
export default async function SymptomPresetDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <SymptomPresetEditorPage presetId={id} />;
}
