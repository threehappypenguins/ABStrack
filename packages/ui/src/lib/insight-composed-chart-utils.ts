import type { SelectedSeries } from './InsightSeriesPicker.types.js';
import type {
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  InsightChartBucket,
} from './InsightComposedChart.types.js';

/** Recharts `dataKey` for a series average value. */
export function chartSeriesValueAvgKey(seriesId: string): string {
  return `${seriesId}__value_avg`;
}

/** Recharts `dataKey` for systolic average (blood pressure band). */
export function chartSeriesSystolicAvgKey(seriesId: string): string {
  return `${seriesId}__systolic_avg`;
}

/** Recharts `dataKey` for diastolic average (blood pressure band). */
export function chartSeriesDiastolicAvgKey(seriesId: string): string {
  return `${seriesId}__diastolic_avg`;
}

/** Recharts field for boolean event counts per bucket. */
export function chartSeriesEventCountKey(seriesId: string): string {
  return `${seriesId}__event_count`;
}

/**
 * Unit key used to group numeric/severity series on shared Y-axes.
 *
 * @param series - Selected series metadata.
 * @returns Stable unit grouping key.
 */
export function insightChartUnitKey(series: SelectedSeries): string {
  if (series.unit) {
    return series.unit;
  }
  if (series.responseType === 'severity') {
    return '__severity__';
  }
  return '__unitless__';
}

export type InsightValueYAxisId = 'left' | 'right' | 'bp';

/**
 * Maximum distinct measurement units for non–blood-pressure value series.
 * The chart exposes one left and one right numeric/severity axis (BP uses `bp`).
 */
export const MAX_DISTINCT_NON_BP_VALUE_UNITS = 2;

/**
 * Whether a selected series consumes a value Y-axis unit slot (not BP or event markers).
 *
 * @param series - Selected series metadata.
 */
export function countsTowardInsightChartValueUnitLimit(
  series: Pick<
    SelectedSeries,
    'chartType' | 'unit' | 'responseType' | 'isBloodPressure'
  >,
): boolean {
  return series.chartType !== 'event' && series.chartType !== 'bp_band';
}

/**
 * Distinct non–blood-pressure value unit keys already present in the selection.
 *
 * @param series - Selected series (in slot order).
 * @param excludeSlotIndex - Optional slot to omit (e.g. the slot being edited).
 */
export function getDistinctNonBpValueUnitKeys(
  series: SelectedSeries[],
  excludeSlotIndex?: number,
): string[] {
  const keys: string[] = [];
  for (const [index, item] of series.entries()) {
    if (excludeSlotIndex !== undefined && index === excludeSlotIndex) {
      continue;
    }
    if (!countsTowardInsightChartValueUnitLimit(item)) {
      continue;
    }
    const unitKey = insightChartUnitKey(item);
    if (!keys.includes(unitKey)) {
      keys.push(unitKey);
    }
  }
  return keys;
}

/**
 * Whether adding `candidate` would exceed {@link MAX_DISTINCT_NON_BP_VALUE_UNITS}.
 *
 * @param current - Current selection.
 * @param candidate - Proposed series for a slot.
 * @param excludeSlotIndex - Slot being replaced (if any).
 */
export function wouldExceedDistinctNonBpValueUnitLimit(
  current: SelectedSeries[],
  candidate: SelectedSeries,
  excludeSlotIndex?: number,
): boolean {
  if (!countsTowardInsightChartValueUnitLimit(candidate)) {
    return false;
  }
  const existing = getDistinctNonBpValueUnitKeys(current, excludeSlotIndex);
  const candidateKey = insightChartUnitKey(candidate);
  if (existing.includes(candidateKey)) {
    return false;
  }
  return existing.length >= MAX_DISTINCT_NON_BP_VALUE_UNITS;
}

/**
 * @param series - Selected series for the chart.
 * @returns `true` when every value series fits on the supported Y-axes.
 */
export function isInsightChartSeriesSupported(
  series: SelectedSeries[],
): boolean {
  return (
    getDistinctNonBpValueUnitKeys(series).length <=
    MAX_DISTINCT_NON_BP_VALUE_UNITS
  );
}

/**
 * User-facing explanation when the selection exceeds supported Y-axis units.
 *
 * @param series - Selected series for the chart.
 * @returns Message when unsupported; otherwise `undefined`.
 */
export function getInsightChartUnsupportedMessage(
  series: SelectedSeries[],
): string | undefined {
  if (isInsightChartSeriesSupported(series)) {
    return undefined;
  }
  return `This chart supports at most ${MAX_DISTINCT_NON_BP_VALUE_UNITS} different measurement units at once (blood pressure uses its own axis). Remove a series or choose series that share units.`;
}

/**
 * Maps each series to its Y-axis id (`null` for event markers with no axis).
 *
 * @param series - Selected series in chart order.
 * @returns Map from `seriesId` to axis id or `null`.
 */
export function assignInsightChartYAxes(
  series: SelectedSeries[],
): Map<string, InsightValueYAxisId | null> {
  const assignments = new Map<string, InsightValueYAxisId | null>();
  const unitOrder = getDistinctNonBpValueUnitKeys(series);

  for (const item of series) {
    if (item.chartType === 'event') {
      assignments.set(item.seriesId, null);
      continue;
    }
    if (item.chartType === 'bp_band') {
      assignments.set(item.seriesId, 'bp');
      continue;
    }

    const unitIndex = unitOrder.indexOf(insightChartUnitKey(item));
    if (unitIndex < 0 || unitIndex >= MAX_DISTINCT_NON_BP_VALUE_UNITS) {
      assignments.set(item.seriesId, null);
    } else if (unitIndex === 0) {
      assignments.set(item.seriesId, 'left');
    } else {
      assignments.set(item.seriesId, 'right');
    }
  }

  if (unitOrder.length <= 1) {
    for (const [seriesId, axisId] of assignments) {
      if (axisId === 'right') {
        assignments.set(seriesId, 'left');
      }
    }
  }

  return assignments;
}

/**
 * Flattens {@link ChartSeriesRow} data for Recharts `ComposedChart`.
 *
 * @param rows - Pivoted bucket rows.
 * @returns Flat records keyed by {@link chartSeriesValueAvgKey} and related helpers.
 */
export function flattenChartSeriesRows(
  rows: ChartSeriesRow[],
): Record<string, string | number | null>[] {
  return rows.map((row) => {
    const flat: Record<string, string | number | null> = {
      bucketStart: row.bucketStart,
    };

    for (const [seriesId, metrics] of Object.entries(row.series)) {
      flat[chartSeriesValueAvgKey(seriesId)] = metrics.value_avg;
      flat[chartSeriesSystolicAvgKey(seriesId)] = metrics.systolic_avg;
      flat[chartSeriesDiastolicAvgKey(seriesId)] = metrics.diastolic_avg;
      flat[chartSeriesEventCountKey(seriesId)] = metrics.event_count;
    }

    return flat;
  });
}

/**
 * @param timeZone - IANA timezone identifier.
 * @returns `true` when `Intl` accepts the zone.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves a patient timezone for chart labels, falling back to UTC when invalid.
 *
 * @param patientTimeZone - Preferred IANA timezone.
 * @returns Valid IANA timezone id.
 */
export function resolveInsightChartTimeZone(patientTimeZone: string): string {
  return isValidIanaTimeZone(patientTimeZone) ? patientTimeZone : 'UTC';
}

/**
 * @param patientTimeZone - IANA timezone id.
 * @returns Display name for the timezone (e.g. `Eastern Standard Time`).
 */
export function formatIanaTimeZoneForDisplay(patientTimeZone: string): string {
  const zone = resolveInsightChartTimeZone(patientTimeZone);
  const parts = new Intl.DateTimeFormat(undefined, {
    timeZone: zone,
    timeZoneName: 'long',
  }).formatToParts(new Date());
  return parts.find((part) => part.type === 'timeZoneName')?.value ?? zone;
}

/**
 * Caption explaining that chart period labels use the patient's timezone.
 *
 * @param patientTimeZone - IANA timezone id.
 * @returns Practitioner-facing note text.
 */
export function formatInsightChartPatientTimeZoneNote(
  patientTimeZone: string,
): string {
  const label = formatIanaTimeZoneForDisplay(patientTimeZone);
  return `Period labels use the patient's local timezone (${label}).`;
}

/**
 * @param bucketStart - ISO `bucket_start` from `get_chart_series`.
 * @param bucket - Bucket granularity.
 * @param patientTimeZone - IANA timezone for label formatting (patient-local).
 * @returns Human-readable bucket label for axes and table headers.
 */
export function formatInsightChartBucketLabel(
  bucketStart: string,
  bucket: InsightChartBucket,
  patientTimeZone: string,
): string {
  const date = new Date(bucketStart);
  if (Number.isNaN(date.getTime())) {
    return bucketStart;
  }

  const timeZone = resolveInsightChartTimeZone(patientTimeZone);

  if (bucket === 'month') {
    return new Intl.DateTimeFormat(undefined, {
      timeZone,
      month: 'short',
      year: 'numeric',
    }).format(date);
  }

  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: bucket === 'week' ? 'numeric' : undefined,
  }).format(date);
}

/**
 * @param value - Numeric cell value.
 * @param unit - Optional unit suffix.
 * @returns Display string for the accessible data table.
 */
export function formatInsightChartTableCell(
  value: number | null | undefined,
  unit?: string | null,
): string {
  if (value === null || value === undefined) {
    return 'No data';
  }
  const formatted = Number.isInteger(value) ? String(value) : value.toFixed(2);
  return unit ? `${formatted} ${unit}` : formatted;
}

export interface InsightChartTableColumn {
  id: string;
  label: string;
  seriesId: string;
  kind: 'value_avg' | 'systolic_avg' | 'diastolic_avg' | 'event_count';
}

/**
 * Builds accessible table columns for the selected series manifest.
 *
 * @param series - Selected series.
 * @returns Column descriptors (blood pressure uses systolic and diastolic columns).
 */
export function buildInsightChartTableColumns(
  series: SelectedSeries[],
): InsightChartTableColumn[] {
  const columns: InsightChartTableColumn[] = [];

  for (const item of series) {
    if (item.chartType === 'bp_band') {
      columns.push(
        {
          id: `${item.seriesId}-systolic`,
          label: `${item.label} (systolic)`,
          seriesId: item.seriesId,
          kind: 'systolic_avg',
        },
        {
          id: `${item.seriesId}-diastolic`,
          label: `${item.label} (diastolic)`,
          seriesId: item.seriesId,
          kind: 'diastolic_avg',
        },
      );
      continue;
    }

    if (item.chartType === 'event') {
      columns.push({
        id: `${item.seriesId}-events`,
        label: `${item.label} (events)`,
        seriesId: item.seriesId,
        kind: 'event_count',
      });
      continue;
    }

    const unitSuffix = item.unit ? ` (${item.unit})` : '';
    columns.push({
      id: `${item.seriesId}-value`,
      label: `${item.label}${unitSuffix}`,
      seriesId: item.seriesId,
      kind: 'value_avg',
    });
  }

  return columns;
}

/**
 * Reads a metric from a bucket row for table rendering.
 *
 * @param row - Chart row.
 * @param column - Table column descriptor.
 * @returns Metric value for the cell.
 */
export function readInsightChartTableMetric(
  row: ChartSeriesRow,
  column: InsightChartTableColumn,
): number | null {
  const metrics: ChartSeriesBucketMetrics | undefined =
    row.series[column.seriesId];
  if (!metrics) {
    return null;
  }
  return metrics[column.kind];
}

/**
 * Raw bucket row from `get_chart_series` (`ChartSeriesBucketRow` in `@abstrack/supabase`).
 * Declared here so `@abstrack/ui` does not depend on `@abstrack/supabase`.
 */
export interface ChartSeriesBucketRowInput {
  series_id: string;
  bucket_start: string;
  value_avg: number | null;
  value_min?: number | null;
  value_max?: number | null;
  systolic_avg: number | null;
  diastolic_avg: number | null;
  event_count: number | null;
}

/**
 * Pivots long-format RPC rows into {@link ChartSeriesRow} records for {@link InsightComposedChart}.
 *
 * @param rows - Output of `get_chart_series`.
 * @returns One row per bucket with nested per-series metrics.
 */
export function pivotChartSeriesBucketRows(
  rows: ChartSeriesBucketRowInput[],
): ChartSeriesRow[] {
  const byBucket = new Map<string, ChartSeriesRow>();

  for (const row of rows) {
    let chartRow = byBucket.get(row.bucket_start);
    if (!chartRow) {
      chartRow = { bucketStart: row.bucket_start, series: {} };
      byBucket.set(row.bucket_start, chartRow);
    }

    chartRow.series[row.series_id] = {
      value_avg: row.value_avg,
      value_min: row.value_min,
      value_max: row.value_max,
      systolic_avg: row.systolic_avg,
      diastolic_avg: row.diastolic_avg,
      event_count: row.event_count,
    };
  }

  return [...byBucket.values()].sort((a, b) =>
    a.bucketStart.localeCompare(b.bucketStart),
  );
}
