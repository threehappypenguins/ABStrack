/**
 * Lightweight entry: pure insights chart helpers and types (no Recharts / picker components).
 * Use from Jest stubs and other test harnesses that must not load `@abstrack/ui/insights-web`.
 */

export {
  filterChartableManifestRows,
  reconcileSelectedSeriesWithManifest,
} from './lib/insight-series-picker-utils.js';
export type {
  ChartManifestRow,
  ChartTypeChoice,
  InsightSeriesPickerProps,
  SelectedSeries,
} from './lib/InsightSeriesPicker.types.js';

export {
  pivotChartSeriesBucketRows,
  type ChartSeriesBucketRowInput,
} from './lib/insight-composed-chart-utils.js';
export type {
  ChartSeriesBucketMetrics,
  ChartSeriesRow,
  InsightChartBucket,
  InsightComposedChartProps,
} from './lib/InsightComposedChart.types.js';

export {
  getInsightDateRangePreset,
  type InsightDateRange,
  type InsightDateRangePresetId,
} from './lib/insight-date-range-picker-utils.js';
export type { InsightDateRangePickerProps } from './lib/InsightDateRangePicker.types.js';
