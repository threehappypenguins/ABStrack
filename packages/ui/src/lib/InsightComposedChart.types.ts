import type {
  ChartTypeChoice,
  SelectedSeries,
} from './InsightSeriesPicker.types.js';
import type { InsightChartTimeZoneNoteVariant } from './insight-composed-chart-utils.js';

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
  /**
   * IANA timezone for bucket axis and table labels (e.g. `America/Chicago`).
   * Must match `p_timezone` on {@link getChartSeries}. When the patient's zone is stored,
   * pass it here; until then the viewer's browser zone is a common fallback for caretaker views.
   */
  patientTimeZone: string;
  /**
   * When true, shows a note explaining which timezone buckets and labels use.
   * Use for caretaker/practitioner views (`patientTimeZoneNoteUsesPatientLocal` should be
   * false unless `patientTimeZone` is the patient's real IANA zone).
   * @defaultValue false
   */
  showPatientTimeZoneNote?: boolean;
  /**
   * When true with {@link showPatientTimeZoneNote}, copy claims patient-local alignment.
   * Ignored when {@link patientTimeZoneNoteVariant} is set.
   * @defaultValue false
   */
  patientTimeZoneNoteUsesPatientLocal?: boolean;
  /**
   * Which timezone source the period note describes. Use `practitionerShared` when restoring
   * a practitioner chart snapshot (`chart_snapshots.chart_timezone`).
   */
  patientTimeZoneNoteVariant?: InsightChartTimeZoneNoteVariant;
}

export type { ChartTypeChoice, SelectedSeries };
