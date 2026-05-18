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
 * Maps each series to its Y-axis id (`null` for event markers with no axis).
 *
 * @param series - Selected series in chart order.
 * @returns Map from `seriesId` to axis id or `null`.
 */
export function assignInsightChartYAxes(
  series: SelectedSeries[],
): Map<string, InsightValueYAxisId | null> {
  const assignments = new Map<string, InsightValueYAxisId | null>();
  const valueSeries = series.filter((item) => item.chartType !== 'event');
  const nonBpValue = valueSeries.filter((item) => item.chartType !== 'bp_band');

  const unitOrder: string[] = [];
  for (const item of nonBpValue) {
    const unitKey = insightChartUnitKey(item);
    if (!unitOrder.includes(unitKey)) {
      unitOrder.push(unitKey);
    }
  }

  const primaryUnit = unitOrder[0];
  const secondaryUnit = unitOrder[1];

  for (const item of series) {
    if (item.chartType === 'event') {
      assignments.set(item.seriesId, null);
      continue;
    }
    if (item.chartType === 'bp_band') {
      assignments.set(item.seriesId, 'bp');
      continue;
    }

    const unitKey = insightChartUnitKey(item);
    assignments.set(item.seriesId, unitKey === primaryUnit ? 'left' : 'right');
  }

  if (secondaryUnit === undefined) {
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
 * @param bucketStart - ISO bucket timestamp.
 * @param bucket - Bucket granularity.
 * @returns Human-readable bucket label for axes and table headers.
 */
export function formatInsightChartBucketLabel(
  bucketStart: string,
  bucket: InsightChartBucket,
): string {
  const date = new Date(bucketStart);
  if (Number.isNaN(date.getTime())) {
    return bucketStart;
  }
  if (bucket === 'month') {
    return date.toLocaleDateString(undefined, {
      month: 'short',
      year: 'numeric',
    });
  }
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: bucket === 'week' ? 'numeric' : undefined,
  });
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
