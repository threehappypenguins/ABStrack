import { EpisodeTemplateEditorPage } from '@/components/episode-templates/EpisodeTemplateEditorPage';

type PageProps = {
  /** Next.js 16 passes dynamic route params as a Promise (await before use). */
  params: Promise<{ id: string }>;
};

/**
 * Edit one episode template.
 *
 * @param props - Next.js route params.
 * @returns Editor route content.
 */
export default async function EpisodeTemplateDetailPage({ params }: PageProps) {
  const { id } = await params;
  return <EpisodeTemplateEditorPage templateId={id} />;
}
