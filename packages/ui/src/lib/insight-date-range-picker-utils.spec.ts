import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clampInsightDateRangeEndToToday,
  clampInsightDateRangeToMaxDays,
  getInsightDateRangePreset,
  inclusiveCalendarDaySpan,
  INSIGHT_DATE_RANGE_MAX_DAYS,
  isInsightDateRangeDayDisabled,
  normalizeInsightDateRange,
  startOfCalendarDay,
} from './insight-date-range-picker-utils.js';

const ANCHOR = new Date(2026, 4, 18, 15, 30, 0); // 2026-05-18 local

function localDate(year: number, monthIndex: number, day: number): Date {
  return new Date(year, monthIndex, day);
}

describe('insight-date-range-picker-utils presets', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('computes Last 7 days as 7 inclusive calendar days ending today', () => {
    const range = getInsightDateRangePreset('last_7_days');
    expect(range).toEqual({
      from: localDate(2026, 4, 12),
      to: localDate(2026, 4, 18),
    });
    expect(inclusiveCalendarDaySpan(range.from, range.to)).toBe(7);
  });

  it('computes Last 30 days as 30 inclusive calendar days ending today', () => {
    const range = getInsightDateRangePreset('last_30_days');
    expect(range).toEqual({
      from: localDate(2026, 3, 19),
      to: localDate(2026, 4, 18),
    });
    expect(inclusiveCalendarDaySpan(range.from, range.to)).toBe(30);
  });

  it('computes Last 90 days as 90 inclusive calendar days ending today', () => {
    const range = getInsightDateRangePreset('last_90_days');
    expect(range).toEqual({
      from: localDate(2026, 1, 17),
      to: localDate(2026, 4, 18),
    });
    expect(inclusiveCalendarDaySpan(range.from, range.to)).toBe(90);
  });

  it('computes Last 12 months as 12 calendar months before today through today', () => {
    const range = getInsightDateRangePreset('last_12_months');
    expect(range).toEqual({
      from: localDate(2025, 4, 18),
      to: localDate(2026, 4, 18),
    });
  });
});

describe('insight-date-range-picker-utils constraints', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(ANCHOR);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('disables calendar days after today', () => {
    expect(isInsightDateRangeDayDisabled(localDate(2026, 4, 18))).toBe(false);
    expect(isInsightDateRangeDayDisabled(localDate(2026, 4, 19))).toBe(true);
  });

  it('clamps ranges longer than two years to 730 inclusive days', () => {
    const range = {
      from: localDate(2020, 0, 1),
      to: localDate(2026, 4, 18),
    };
    const clamped = clampInsightDateRangeToMaxDays(range);
    expect(inclusiveCalendarDaySpan(clamped.from, clamped.to)).toBe(
      INSIGHT_DATE_RANGE_MAX_DAYS,
    );
    expect(clamped.to).toEqual(startOfCalendarDay(range.to));
    expect(clamped.from).toEqual(localDate(2024, 4, 19));
  });

  it('pulls future end dates back to today when normalizing', () => {
    const normalized = normalizeInsightDateRange({
      from: localDate(2026, 4, 1),
      to: localDate(2026, 5, 1),
    });
    expect(normalized.to).toEqual(localDate(2026, 4, 18));
  });

  it('clamps end to today when the range end is in the future', () => {
    const clamped = clampInsightDateRangeEndToToday({
      from: localDate(2026, 4, 10),
      to: localDate(2026, 6, 1),
    });
    expect(clamped).toEqual({
      from: localDate(2026, 4, 10),
      to: localDate(2026, 4, 18),
    });
  });
});
