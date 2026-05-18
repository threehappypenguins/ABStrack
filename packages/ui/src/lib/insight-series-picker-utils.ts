import type {
  ChartableManifestRow,
  ChartManifestRow,
  ChartTypeChoice,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

/** Maximum number of series the chart builder allows. */
export const MAX_SERIES_SLOTS = 3;

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

/** Fixed accessible colors per slot (length must match {@link MAX_SERIES_SLOTS}). */
export const INSIGHT_SERIES_SLOT_COLORS = [
  '#1d4ed8',
  '#b45309',
  '#047857',
] as const satisfies readonly [string, string, string];

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
 * Applies a series selection at `slotIndex`, keeping later slots when still valid and
 * distinct; drops tail entries that duplicate an earlier `seriesId`.
 *
 * @param value - Current selected series (already clamped to {@link MAX_SERIES_SLOTS}).
 * @param slotIndex - Slot being updated.
 * @param selected - New selection for that slot.
 * @returns Updated series list (not re-clamped; caller should clamp if needed).
 */
export function mergeSeriesSelectionAtSlot(
  value: SelectedSeries[],
  slotIndex: number,
  selected: SelectedSeries,
): SelectedSeries[] {
  const next = value.slice();
  next[slotIndex] = selected;

  const usedIds = new Set(
    next.slice(0, slotIndex + 1).map((series) => series.seriesId),
  );
  const merged = next.slice(0, slotIndex + 1);

  for (let i = slotIndex + 1; i < next.length; i++) {
    const tail = next[i];
    if (tail && !usedIds.has(tail.seriesId)) {
      merged.push(tail);
      usedIds.add(tail.seriesId);
    }
  }

  return merged;
}

/**
 * Computes how many series slots should be visible for the current value and reveal count.
 *
 * @param value - Currently selected series (up to {@link MAX_SERIES_SLOTS}).
 * @param revealedSlotCount - Slots revealed via “Add another series”.
 * @returns Visible slot count between 1 and {@link MAX_SERIES_SLOTS}.
 */
export function computeVisibleSlotCount(
  value: SelectedSeries[],
  revealedSlotCount: number,
): number {
  const filledCount = value.length;
  const nextUnfilledCap =
    filledCount === 0 ? 1 : Math.min(MAX_SERIES_SLOTS, filledCount + 1);
  return Math.min(
    MAX_SERIES_SLOTS,
    Math.max(filledCount, Math.min(revealedSlotCount, nextUnfilledCap), 1),
  );
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
  if (visibleSlotCount >= MAX_SERIES_SLOTS) {
    return false;
  }
  const lastVisibleIndex = visibleSlotCount - 1;
  return value[lastVisibleIndex] !== undefined;
}
