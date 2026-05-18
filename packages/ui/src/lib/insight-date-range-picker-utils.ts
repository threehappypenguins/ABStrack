/** Maximum inclusive span for a chart date range (2 × 365 calendar days). */
export const INSIGHT_DATE_RANGE_MAX_DAYS = 730;

export type InsightDateRange = {
  from: Date;
  to: Date;
};

export type InsightDateRangePresetId =
  | 'last_7_days'
  | 'last_30_days'
  | 'last_90_days'
  | 'last_12_months';

/** Preset quick-select options shown above the calendar. */
export const INSIGHT_DATE_RANGE_PRESETS: ReadonlyArray<{
  id: InsightDateRangePresetId;
  label: string;
}> = [
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'last_30_days', label: 'Last 30 days' },
  { id: 'last_90_days', label: 'Last 90 days' },
  { id: 'last_12_months', label: 'Last 12 months' },
];

/**
 * Normalizes a date to local midnight (calendar day).
 *
 * @param date - Input instant.
 * @returns Start of that calendar day in local time.
 */
export function startOfCalendarDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/**
 * Returns inclusive calendar-day count between two dates (minimum 1).
 *
 * @param from - Range start (calendar day).
 * @param to - Range end (calendar day).
 * @returns Number of days in the closed interval.
 */
export function inclusiveCalendarDaySpan(from: Date, to: Date): number {
  const start = startOfCalendarDay(from).getTime();
  const end = startOfCalendarDay(to).getTime();
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.max(1, Math.floor((end - start) / msPerDay) + 1);
}

/**
 * Adds calendar days to a date (local), returning start-of-day.
 *
 * @param date - Anchor day.
 * @param days - Days to add (negative to subtract).
 * @returns New date at local midnight.
 */
export function addCalendarDays(date: Date, days: number): Date {
  const result = startOfCalendarDay(date);
  result.setDate(result.getDate() + days);
  return result;
}

/**
 * Subtracts whole calendar months from a date (local), returning start-of-day.
 *
 * @param date - Anchor day.
 * @param months - Months to subtract.
 * @returns Start-of-day result (month-end overflow handled by the `Date` object).
 */
export function subtractCalendarMonths(date: Date, months: number): Date {
  const result = startOfCalendarDay(date);
  result.setMonth(result.getMonth() - months);
  return startOfCalendarDay(result);
}

/**
 * Today's calendar date in local time (midnight).
 *
 * @param anchor - Reference instant (default now).
 * @returns Start of the anchor's calendar day.
 */
export function getTodayCalendarDate(anchor: Date = new Date()): Date {
  return startOfCalendarDay(anchor);
}

/**
 * Ensures `from` is on or before `to`, both at start-of-day.
 *
 * @param range - Candidate range.
 * @returns Ordered range at calendar-day precision.
 */
export function ensureOrderedInsightDateRange(
  range: InsightDateRange,
): InsightDateRange {
  let from = startOfCalendarDay(range.from);
  let to = startOfCalendarDay(range.to);
  if (from.getTime() > to.getTime()) {
    [from, to] = [to, from];
  }
  return { from, to };
}

/**
 * Clamps the range end to today and pulls the start forward if needed.
 *
 * @param range - Candidate range.
 * @param anchor - Reference "today" (default now).
 * @returns Range ending no later than the anchor's calendar day.
 */
export function clampInsightDateRangeEndToToday(
  range: InsightDateRange,
  anchor: Date = new Date(),
): InsightDateRange {
  const today = getTodayCalendarDate(anchor);
  let { from, to } = ensureOrderedInsightDateRange(range);
  if (to.getTime() > today.getTime()) {
    to = today;
  }
  if (from.getTime() > to.getTime()) {
    from = to;
  }
  return { from, to };
}

/**
 * Shortens the range so it spans at most {@link INSIGHT_DATE_RANGE_MAX_DAYS} days,
 * preserving the end date when possible.
 *
 * @param range - Candidate range.
 * @param maxDays - Maximum inclusive days (default 2 years).
 * @returns Clamped range.
 */
export function clampInsightDateRangeToMaxDays(
  range: InsightDateRange,
  maxDays: number = INSIGHT_DATE_RANGE_MAX_DAYS,
): InsightDateRange {
  const ordered = ensureOrderedInsightDateRange(range);
  let from = ordered.from;
  const { to } = ordered;
  const span = inclusiveCalendarDaySpan(from, to);
  if (span <= maxDays) {
    return { from, to };
  }
  from = addCalendarDays(to, -(maxDays - 1));
  return { from, to };
}

/**
 * Applies ordering, end-of-today clamp, and max-span clamp for chart ranges.
 *
 * @param range - Candidate range.
 * @param anchor - Reference "today" (default now).
 * @returns Normalized range safe for the chart builder.
 */
export function normalizeInsightDateRange(
  range: InsightDateRange,
  anchor: Date = new Date(),
): InsightDateRange {
  return clampInsightDateRangeToMaxDays(
    clampInsightDateRangeEndToToday(range, anchor),
  );
}

/**
 * `react-day-picker` matchers: disable future calendar days after today.
 *
 * @param anchor - Reference "today" (default now).
 * @returns Matchers for the `disabled` prop.
 */
export function getInsightDateRangeDisabledMatchers(
  anchor: Date = new Date(),
): Array<{ after: Date }> {
  return [{ after: getTodayCalendarDate(anchor) }];
}

/**
 * Returns whether a calendar day should be disabled (future dates).
 *
 * @param day - Day under test.
 * @param anchor - Reference "today" (default now).
 * @returns True when the day is after today.
 */
export function isInsightDateRangeDayDisabled(
  day: Date,
  anchor: Date = new Date(),
): boolean {
  return (
    startOfCalendarDay(day).getTime() > getTodayCalendarDate(anchor).getTime()
  );
}

/**
 * Inclusive range covering the last N calendar days ending on `to`.
 *
 * @param to - Range end (calendar day).
 * @param dayCount - Number of inclusive days (e.g. 7 for “last 7 days”).
 * @returns Range with exactly `dayCount` days when possible before `to`.
 */
export function getLastNDaysInsightDateRange(
  to: Date,
  dayCount: number,
): InsightDateRange {
  const end = startOfCalendarDay(to);
  let from = addCalendarDays(end, -(dayCount - 1));
  while (inclusiveCalendarDaySpan(from, end) < dayCount) {
    from = addCalendarDays(from, -1);
  }
  return { from, to: end };
}

/**
 * Computes a preset range ending on the anchor's calendar day.
 *
 * @param presetId - Preset identifier.
 * @param anchor - Range end (default today).
 * @returns Inclusive local-date range for the preset.
 */
export function getInsightDateRangePreset(
  presetId: InsightDateRangePresetId,
  anchor: Date = new Date(),
): InsightDateRange {
  const to = getTodayCalendarDate(anchor);
  switch (presetId) {
    case 'last_7_days':
      return getLastNDaysInsightDateRange(to, 7);
    case 'last_30_days':
      return getLastNDaysInsightDateRange(to, 30);
    case 'last_90_days':
      return getLastNDaysInsightDateRange(to, 90);
    case 'last_12_months':
      return { from: subtractCalendarMonths(to, 12), to };
    default: {
      const _exhaustive: never = presetId;
      return _exhaustive;
    }
  }
}

/**
 * Screen-reader announcement for a selected chart date range.
 *
 * @param range - Selected range.
 * @returns Plain-language status message.
 */
export function formatInsightDateRangeAnnouncement(
  range: InsightDateRange,
): string {
  const formatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
  return `Date range selected: ${formatter.format(range.from)} to ${formatter.format(range.to)}`;
}
