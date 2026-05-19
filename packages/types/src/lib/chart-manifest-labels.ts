import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  type PresetHealthMarkerKind,
} from './types.js';

const HEALTH_MARKER_SERIES_PREFIX = 'health_marker::';

/**
 * Maps a preset `marker_kind` key to {@link PRESET_HEALTH_MARKER_KIND_LABELS}.
 *
 * @param markerKey - Suffix after `health_marker::` (e.g. `bac`, or `custom::steps`).
 * @returns Preset display label, or `undefined` when the key is custom or not a preset kind.
 */
function presetHealthMarkerLabelForKey(markerKey: string): string | undefined {
  if (
    Object.hasOwn(PRESET_HEALTH_MARKER_KIND_LABELS, markerKey) &&
    markerKey !== 'custom' &&
    !markerKey.includes('::')
  ) {
    return PRESET_HEALTH_MARKER_KIND_LABELS[
      markerKey as PresetHealthMarkerKind
    ];
  }
  return undefined;
}

/**
 * Human-readable label for a health-marker row from `get_user_chart_manifest`.
 *
 * The RPC uses `coalesce(custom_name, marker_kind)` for `label`, so preset kinds without
 * a stored custom name surface as snake_case keys (`bac`, `blood_glucose`). Preset kinds
 * use `health_marker::<kind>` and map through {@link PRESET_HEALTH_MARKER_KIND_LABELS}
 * (same copy as the health-marker preset UI). Custom markers use `health_marker::custom::<name>`
 * and keep the RPC label (even when the custom name matches a preset key string).
 *
 * @param seriesId - Manifest `series_id` (e.g. `health_marker::bac`).
 * @param rpcLabel - `label` returned by the RPC.
 * @returns Display label for chart pickers and summaries.
 */
export function chartManifestHealthMarkerDisplayLabel(
  seriesId: string,
  rpcLabel: string,
): string {
  if (seriesId.startsWith(HEALTH_MARKER_SERIES_PREFIX)) {
    const fromSeriesId = presetHealthMarkerLabelForKey(
      seriesId.slice(HEALTH_MARKER_SERIES_PREFIX.length),
    );
    if (fromSeriesId) {
      return fromSeriesId;
    }
  }

  return rpcLabel;
}

/**
 * Human-readable label for any manifest series row.
 *
 * @param seriesType - Manifest `series_type`.
 * @param seriesId - Manifest `series_id`.
 * @param rpcLabel - `label` from the RPC.
 * @returns Display label for chart UI.
 */
export function chartManifestSeriesDisplayLabel(
  seriesType: 'health_marker' | 'symptom',
  seriesId: string,
  rpcLabel: string,
): string {
  if (seriesType === 'health_marker') {
    return chartManifestHealthMarkerDisplayLabel(seriesId, rpcLabel);
  }
  return rpcLabel;
}
