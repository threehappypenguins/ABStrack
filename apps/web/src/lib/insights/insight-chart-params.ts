import type {
  ChartSnapshotSeriesDefinition,
  ChartSeriesSelection,
} from '@abstrack/supabase';
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

type CalendarDayParts = {
  year: number;
  month: number;
  day: number;
};

/**
 * Start of the local calendar day for an instant (matches {@link InsightDateRangePicker}).
 *
 * @param date - Input instant.
 * @returns Local midnight on that calendar day.
 */
function toLocalCalendarDay(date: Date): Date {
  const day = new Date(date);
  day.setHours(0, 0, 0, 0);
  return day;
}

/**
 * Calendar day parts for an instant in an IANA timezone.
 *
 * @param iso - ISO timestamp.
 * @param timeZone - IANA timezone name.
 * @returns Year, month (1–12), and day in that zone.
 */
function calendarDayPartsInTimeZone(
  iso: string,
  timeZone: string,
): CalendarDayParts {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
  });
  const parts = formatter.formatToParts(new Date(iso));
  const year = Number(parts.find((part) => part.type === 'year')?.value);
  const month = Number(parts.find((part) => part.type === 'month')?.value);
  const day = Number(parts.find((part) => part.type === 'day')?.value);
  return { year, month, day };
}

/**
 * Builds a {@link Date} at local midnight using calendar components (for the date picker).
 *
 * @param parts - Calendar day in the practitioner's chart zone.
 * @returns Local midnight with those Y/M/D fields.
 */
function calendarPartsToLocalDate(parts: CalendarDayParts): Date {
  return new Date(parts.year, parts.month - 1, parts.day);
}

/**
 * Previous calendar day (local date arithmetic on Y/M/D components).
 *
 * @param parts - Starting calendar day.
 * @returns Previous day.
 */
function previousCalendarDay(parts: CalendarDayParts): CalendarDayParts {
  const date = new Date(parts.year, parts.month - 1, parts.day);
  date.setDate(date.getDate() - 1);
  return {
    year: date.getFullYear(),
    month: date.getMonth() + 1,
    day: date.getDate(),
  };
}

/**
 * Converts stored snapshot bounds (`date_from` inclusive, `date_to` exclusive) to an
 * {@link InsightDateRange} for the date picker and chart summary.
 *
 * When `chartTimeZone` is set, calendar days match the practitioner's chart zone (not the
 * patient's current browser zone). Returned dates are local midnights so
 * {@link InsightDateRangePicker} normalization does not clear an in-flight restore.
 *
 * @param dateFrom - Snapshot `date_from` (ISO).
 * @param dateTo - Snapshot `date_to` exclusive end (ISO).
 * @param chartTimeZone - IANA zone from `chart_snapshots.chart_timezone`; omit for legacy rows.
 * @returns Inclusive local calendar range for the UI.
 */
export function chartSnapshotBoundsToInsightDateRange(
  dateFrom: string,
  dateTo: string,
  chartTimeZone?: string | null,
): InsightDateRange {
  const trimmedZone = chartTimeZone?.trim();
  if (trimmedZone == null || trimmedZone.length === 0) {
    const from = toLocalCalendarDay(new Date(dateFrom));
    const toExclusive = toLocalCalendarDay(new Date(dateTo));
    const to = new Date(toExclusive);
    to.setDate(to.getDate() - 1);
    return { from, to };
  }

  const from = calendarPartsToLocalDate(
    calendarDayPartsInTimeZone(dateFrom, trimmedZone),
  );
  const to = calendarPartsToLocalDate(
    previousCalendarDay(calendarDayPartsInTimeZone(dateTo, trimmedZone)),
  );
  return { from, to };
}

/**
 * Restores practitioner-shared {@link SelectedSeries} from `chart_snapshots.series_definition`.
 *
 * @param definition - Stored snapshot series rows.
 * @returns Series selection for {@link InsightSeriesPicker} and {@link InsightComposedChart}.
 */
export function chartSnapshotDefinitionToSelectedSeries(
  definition: ChartSnapshotSeriesDefinition[],
): SelectedSeries[] {
  return definition.map((item) => ({
    seriesId: item.seriesId,
    seriesType: item.seriesType,
    responseType: item.responseType,
    isBloodPressure: item.isBloodPressure,
    label: item.label,
    unit: item.unit,
    chartType: item.chartType,
    color: item.color,
  }));
}
