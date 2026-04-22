import type { HealthMarkerRow } from './types.js';

/**
 * PRD §4: ABS may be suggested when any logged BAC value is above zero.
 *
 * @param markers - Episode health marker rows for the active episode.
 * @returns `true` when a `bac` marker has `value_numeric` greater than zero.
 */
export function bacReadingSuggestsAbsEpisode(
  markers: Pick<HealthMarkerRow, 'marker_kind' | 'value_numeric'>[],
): boolean {
  return markers.some(
    (m) =>
      m.marker_kind === 'bac' && m.value_numeric != null && m.value_numeric > 0,
  );
}
