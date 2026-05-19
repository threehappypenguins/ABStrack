import type { ChartSeriesSelection } from '@abstrack/supabase';
import type {
  InsightChartBucket,
  InsightDateRange,
  SelectedSeries,
} from '@abstrack/ui';

/**
 * Default insights date range: last 30 inclusive calendar days ending today (local).
 *
 * @returns Preset range for initial chart filters.
 */
export function getDefaultInsightDateRange(): InsightDateRange {
  const to = new Date();
  to.setHours(0, 0, 0, 0);
  const from = new Date(to);
  from.setDate(from.getDate() - 29);
  return { from, to };
}

/**
 * Local-calendar-day bounds for `get_chart_series` (`p_from` inclusive, `p_to` exclusive).
 * Uses the browser's local timezone, matching {@link InsightDateRangePicker} calendar days.
 * `p_to` is midnight on the day after `range.to` so the RPC can use `recorded_at < p_to` and
 * include observations with sub-millisecond timestamps on the last selected day.
 *
 * @param range - Selected inclusive chart date range.
 * @returns ISO timestamps for RPC range filters.
 */
export function insightDateRangeToRpcBounds(range: InsightDateRange): {
  p_from: string;
  p_to: string;
} {
  const from = new Date(range.from);
  from.setHours(0, 0, 0, 0);
  const toExclusive = new Date(range.to);
  toExclusive.setHours(0, 0, 0, 0);
  toExclusive.setDate(toExclusive.getDate() + 1);
  return {
    p_from: from.toISOString(),
    p_to: toExclusive.toISOString(),
  };
}

/**
 * Maps UI selected series to `get_chart_series` `p_series` elements.
 *
 * @param series - Series chosen in {@link InsightSeriesPicker}.
 * @returns RPC selection payload.
 */
export function selectedSeriesToChartSeriesSelection(
  series: SelectedSeries[],
): ChartSeriesSelection[] {
  return series.map((item) => ({
    series_id: item.seriesId,
    series_type: item.seriesType,
    response_type: item.responseType,
    is_blood_pressure: item.isBloodPressure,
  }));
}

const BUCKET_SUMMARY_LABEL: Record<InsightChartBucket, string> = {
  day: 'grouped by day',
  week: 'grouped by week',
  month: 'grouped by month',
};

function formatSeriesLabelsForSummary(labels: string[]): string {
  if (labels.length === 0) {
    return 'Selected series';
  }
  if (labels.length === 1) {
    const [only] = labels;
    return only ?? 'Selected series';
  }
  if (labels.length === 2) {
    return `${labels[0]} and ${labels[1]}`;
  }
  return `${labels.slice(0, -1).join(', ')}, and ${labels[labels.length - 1]}`;
}

/**
 * Plain-English chart summary for {@link InsightComposedChart} and screen readers.
 *
 * @param labels - Human-readable series labels from the manifest.
 * @param range - Active inclusive date range.
 * @param bucket - Active chart period (day, week, or month).
 * @returns Summary sentence (e.g. "BAC readings from April 1 to April 30, grouped by day").
 */
export function formatInsightChartPageSummary(
  labels: string[],
  range: InsightDateRange,
  bucket: InsightChartBucket,
): string {
  const dateFormatter = new Intl.DateTimeFormat(undefined, {
    month: 'long',
    day: 'numeric',
  });
  const seriesPart = formatSeriesLabelsForSummary(labels);
  const fromLabel = dateFormatter.format(range.from);
  const toLabel = dateFormatter.format(range.to);
  return `${seriesPart} from ${fromLabel} to ${toLabel}, ${BUCKET_SUMMARY_LABEL[bucket]}`;
}
