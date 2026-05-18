import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  type PresetHealthMarkerKind,
} from './types.js';

const HEALTH_MARKER_SERIES_PREFIX = 'health_marker::';

/**
 * Human-readable label for a health-marker row from `get_user_chart_manifest`.
 *
 * The RPC uses `coalesce(custom_name, marker_kind)` for `label`, so preset kinds without
 * a stored custom name surface as snake_case keys (`bac`, `blood_glucose`). This maps those
 * to {@link PRESET_HEALTH_MARKER_KIND_LABELS} (same copy as the health-marker preset UI).
 *
 * @param seriesId - Manifest `series_id` (e.g. `health_marker::bac`).
 * @param rpcLabel - `label` returned by the RPC.
 * @returns Display label for chart pickers and summaries.
 */
function presetHealthMarkerLabelForKey(markerKey: string): string | undefined {
  if (
    markerKey in PRESET_HEALTH_MARKER_KIND_LABELS &&
    markerKey !== 'custom' &&
    !markerKey.includes('::')
  ) {
    return PRESET_HEALTH_MARKER_KIND_LABELS[
      markerKey as PresetHealthMarkerKind
    ];
  }
  return undefined;
}

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

  const fromRpcLabel = presetHealthMarkerLabelForKey(rpcLabel);
  if (fromRpcLabel) {
    return fromRpcLabel;
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
