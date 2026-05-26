/**
 * Web-only entry: insights chart builder components without pulling React Native
 * from the main `@abstrack/ui` barrel (NavigationShell, Dialog, etc.).
 *
 * Use from Next.js apps (`apps/web`, `apps/practitioner`) for chart filters and rendering.
 */

export {
  InsightSeriesPicker,
  type ChartManifestRow,
  type ChartTypeChoice,
  type InsightSeriesPickerProps,
  type SelectedSeries,
} from './lib/InsightSeriesPicker.js';
export { InsightDateRangePicker } from './lib/InsightDateRangePicker.js';
export type {
  InsightDateRange,
  InsightDateRangePickerProps,
  InsightDateRangePresetId,
} from './lib/InsightDateRangePicker.js';
export { getInsightDateRangePreset } from './lib/insight-date-range-picker-utils.js';
export {
  InsightComposedChart,
  type ChartSeriesBucketMetrics,
  type ChartSeriesRow,
  type InsightChartBucket,
  type InsightComposedChartProps,
} from './lib/InsightComposedChart.js';
export {
  InsightsSummarySection,
  type InsightsStartHourDistributionRow,
  type InsightsSummaryMetrics,
  type InsightsSummarySectionProps,
  type InsightsSymptomFrequencyRow,
  type InsightsWeekCountRow,
} from './lib/InsightsSummarySection.js';
export {
  pivotChartSeriesBucketRows,
  type ChartSeriesBucketRowInput,
} from './lib/insight-composed-chart-utils.js';
export {
  filterChartableManifestRows,
  reconcileSelectedSeriesWithManifest,
} from './lib/insight-series-picker-utils.js';
