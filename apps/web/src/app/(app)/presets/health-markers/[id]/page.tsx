import { HealthMarkerPresetEditorPage } from '@/components/health-marker-presets/HealthMarkerPresetEditorPage';

type PageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ id: string }>;
};

/**
 * Edit one health marker preset: lines, marker types, reorder.
 *
 * @param props - Next.js route params.
 * @returns Editor route content.
 */
export default async function HealthMarkerPresetDetailPage({
  params,
}: PageProps) {
  const { id } = await params;
  return <HealthMarkerPresetEditorPage presetId={id} />;
}
