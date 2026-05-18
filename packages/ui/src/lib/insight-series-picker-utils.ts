import type {
  ChartableManifestRow,
  ChartManifestRow,
  ChartTypeChoice,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

/**
 * Whether a manifest row can be selected in the chart builder.
 *
 * @param row - Row from `get_user_chart_manifest`.
 * @returns `true` when the row has at least one allowed chart type.
 */
export function isChartableManifestRow(
  row: ChartManifestRow,
): row is ChartableManifestRow {
  return getChartTypeChoicesForManifestRow(row).length > 0;
}

/**
 * Returns only manifest rows the chart builder can plot.
 *
 * @param manifest - Full RPC manifest (may include unsupported `response_type` values).
 * @returns Rows with at least one allowed chart type.
 */
export function filterChartableManifestRows(
  manifest: ChartManifestRow[],
): ChartableManifestRow[] {
  return manifest.filter(isChartableManifestRow);
}

/** Fixed accessible colors for series slots 1–3 (not user-configurable). */
export const INSIGHT_SERIES_SLOT_COLORS = [
  '#1d4ed8',
  '#b45309',
  '#047857',
] as const;

const CHART_TYPE_LABELS: Record<ChartTypeChoice, string> = {
  line: 'Line',
  bar: 'Bar',
  scatter: 'Scatter',
  event: 'Event markers',
  bp_band: 'Blood pressure band',
};

/**
 * Returns chart-type choices allowed for a manifest row.
 *
 * @param row - Manifest row describing the series.
 * @returns Allowed chart types for the row.
 */
export function getChartTypeChoicesForManifestRow(
  row: ChartManifestRow,
): ChartTypeChoice[] {
  if (row.is_blood_pressure) {
    return ['bp_band'];
  }
  switch (row.response_type) {
    case 'numeric':
      return ['line', 'bar', 'scatter'];
    case 'severity':
      return ['line', 'bar'];
    case 'boolean':
      return ['event'];
    case 'text':
      return [];
    default:
      return [];
  }
}

/**
 * Whether the chart-type dropdown should be hidden (single forced choice).
 *
 * @param row - Manifest row describing the series.
 * @returns `true` when only one chart type applies.
 */
export function isChartTypeSelectorHidden(row: ChartableManifestRow): boolean {
  return getChartTypeChoicesForManifestRow(row).length <= 1;
}

/**
 * Default chart type for a manifest row (first allowed choice).
 *
 * @param row - Manifest row describing the series.
 * @returns Default chart type, or `undefined` when the row has no chart types.
 */
export function defaultChartTypeForManifestRow(
  row: ChartManifestRow,
): ChartTypeChoice | undefined {
  return getChartTypeChoicesForManifestRow(row)[0];
}

/**
 * Human-readable label for a chart type option.
 *
 * @param chartType - Chart type choice.
 * @returns Display label.
 */
export function chartTypeChoiceLabel(chartType: ChartTypeChoice): string {
  return CHART_TYPE_LABELS[chartType];
}

/**
 * Builds a {@link SelectedSeries} from a manifest row and slot index (assigns color).
 *
 * @param row - Manifest row for the series.
 * @param slotIndex - Zero-based slot index (0–2).
 * @param chartType - Optional chart type; defaults to the row's allowed default.
 * @returns Selected series state, or `undefined` when the row has no valid chart type.
 */
export function createSelectedSeriesFromManifestRow(
  row: ChartableManifestRow,
  slotIndex: number,
  chartType?: ChartTypeChoice,
): SelectedSeries | undefined {
  const allowed = getChartTypeChoicesForManifestRow(row);
  const resolvedChartType = chartType ?? allowed[0];
  if (!resolvedChartType || !allowed.includes(resolvedChartType)) {
    return undefined;
  }

  return {
    seriesId: row.series_id,
    seriesType: row.series_type,
    responseType: row.response_type,
    isBloodPressure: row.is_blood_pressure,
    label: row.label,
    unit: row.unit,
    chartType: resolvedChartType,
    color:
      INSIGHT_SERIES_SLOT_COLORS[slotIndex] ?? INSIGHT_SERIES_SLOT_COLORS[0],
  };
}

/**
 * Computes how many series slots should be visible for the current value and reveal count.
 *
 * @param value - Currently selected series (up to 3).
 * @param revealedSlotCount - Slots revealed via “Add another series” (1–3).
 * @returns Visible slot count between 1 and 3.
 */
export function computeVisibleSlotCount(
  value: SelectedSeries[],
  revealedSlotCount: number,
): number {
  const fromValue =
    value.length === 0 ? 1 : Math.min(3, Math.max(1, value.length));
  return Math.min(3, Math.max(1, revealedSlotCount, fromValue));
}

/**
 * Whether “Add another series” should be offered.
 *
 * @param value - Currently selected series.
 * @param visibleSlotCount - Number of slots currently shown.
 * @returns `true` when another slot can be added.
 */
export function canAddAnotherSeries(
  value: SelectedSeries[],
  visibleSlotCount: number,
): boolean {
  if (visibleSlotCount >= 3) {
    return false;
  }
  const lastVisibleIndex = visibleSlotCount - 1;
  return value[lastVisibleIndex] !== undefined;
}
