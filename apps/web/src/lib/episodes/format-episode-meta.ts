import type { EpisodeRow } from '@abstrack/types';

/**
 * Pure string helpers for episode rows safe to run in Server Components.
 * For localized date/time strings, use {@link EpisodeLocaleInstant} from
 * `@/components/episodes/EpisodeLocaleInstant` so formatting uses the viewer’s locale and time zone
 * in the browser (not Node).
 */

/**
 * User-facing line for episode type and optional custom label.
 *
 * @param episode - Episode row fields used for display.
 * @returns e.g. `ABS` or `ABS — label`.
 */
export function formatEpisodeTypeSummary(
  episode: Pick<EpisodeRow, 'episode_type' | 'episode_label'>,
): string {
  const label = episode.episode_label?.trim();
  return label ? `${episode.episode_type} — ${label}` : episode.episode_type;
}
