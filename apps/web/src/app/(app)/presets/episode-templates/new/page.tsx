import { EpisodeTemplateCreateForm } from '@/components/episode-templates/EpisodeTemplateCreateForm';

/**
 * Create a new episode template (symptom preset + health marker preset + display name).
 *
 * @returns Create route content.
 */
export default function NewEpisodeTemplatePage() {
  return <EpisodeTemplateCreateForm />;
}
