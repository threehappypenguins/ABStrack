import type { EpisodeRow } from '@abstrack/types';

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

/**
 * Formats an ISO timestamp for the user’s locale in the browser.
 *
 * @param iso - `IsoTimestamptz` string.
 * @returns Localized date and short time.
 */
export function formatEpisodeInstant(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
