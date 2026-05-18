import type {
  ChartTypeChoice,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';

/** Time bucket granularity for insight charts (matches `get_chart_series`). */
export type InsightChartBucket = 'day' | 'week' | 'month';

/**
 * Aggregated metrics for one selected series in one time bucket.
 * Field names align with `get_chart_series` RPC columns.
 */
export interface ChartSeriesBucketMetrics {
  value_avg: number | null;
  value_min?: number | null;
  value_max?: number | null;
  systolic_avg: number | null;
  diastolic_avg: number | null;
  event_count: number | null;
}

/**
 * One row of pre-pivoted chart data (one bucket, all selected series).
 * Keys in `series` are manifest `series_id` values.
 */
export interface ChartSeriesRow {
  /** ISO `bucket_start` timestamp from `get_chart_series`. */
  bucketStart: string;
  series: Record<string, ChartSeriesBucketMetrics>;
}

/** Props for {@link InsightComposedChart}. */
export interface InsightComposedChartProps {
  series: SelectedSeries[];
  data: ChartSeriesRow[];
  bucket: InsightChartBucket;
  loading: boolean;
  /** Plain-English summary of the chart for screen readers — required. */
  summary: string;
}

export type { ChartTypeChoice, SelectedSeries };
