import { localInputValueToIso, toLocalDateTimeInputValue } from './date-time';

describe('food diary date-time helpers', () => {
  it('returns empty string for an invalid ISO input', () => {
    expect(toLocalDateTimeInputValue('not-a-real-iso')).toBe('');
  });

  it('round-trips an ISO value through datetime-local format', () => {
    const iso = '2026-01-15T13:45:00.000Z';
    const local = toLocalDateTimeInputValue(iso);

    expect(local).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
    expect(localInputValueToIso(local)).toBe(iso);
  });

  it('parses optional seconds in datetime-local input', () => {
    const value = '2026-01-15T08:09:10';
    const expected = new Date(2026, 0, 15, 8, 9, 10, 0).toISOString();

    expect(localInputValueToIso(value)).toBe(expected);
  });

  it('returns null for malformed or out-of-range inputs', () => {
    expect(localInputValueToIso('')).toBeNull();
    expect(localInputValueToIso('not-a-date')).toBeNull();
    expect(localInputValueToIso('2026-13-15T08:09')).toBeNull();
    expect(localInputValueToIso('2026-02-30T08:09')).toBeNull();
    expect(localInputValueToIso('2026-01-15T24:00')).toBeNull();
    expect(localInputValueToIso('2026-01-15T08:60')).toBeNull();
    expect(localInputValueToIso('2026-01-15T08:09:99')).toBeNull();
  });
});

describe('food diary date-time DST gap handling', () => {
  function pad2(value: number): string {
    return String(value).padStart(2, '0');
  }

  function toLocalInput(
    year: number,
    month1: number,
    day: number,
    hour: number,
    minute: number,
  ): string {
    return `${year}-${pad2(month1)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
  }

  function findSpringForwardGap(): {
    year: number;
    month1: number;
    day: number;
    hour: number;
    minute: number;
  } | null {
    for (let year = 2020; year <= 2032; year += 1) {
      for (let month0 = 0; month0 < 12; month0 += 1) {
        const daysInMonth = new Date(year, month0 + 1, 0).getDate();
        for (let day = 1; day <= daysInMonth; day += 1) {
          for (let hour = 1; hour <= 22; hour += 1) {
            const minute = 30;
            const local = new Date(year, month0, day, hour, minute, 0, 0);
            const sameCalendarDay =
              local.getFullYear() === year &&
              local.getMonth() === month0 &&
              local.getDate() === day;
            if (sameCalendarDay && local.getHours() > hour) {
              return { year, month1: month0 + 1, day, hour, minute };
            }
          }
        }
      }
    }
    return null;
  }

  it('rejects nonexistent local times in the spring-forward gap', () => {
    const gap = findSpringForwardGap();
    if (!gap) {
      // Some environments run in non-DST zones; ensure helper still parses valid local input.
      expect(localInputValueToIso('2026-01-15T08:09')).not.toBeNull();
      return;
    }
    const value = toLocalInput(
      gap.year,
      gap.month1,
      gap.day,
      gap.hour,
      gap.minute,
    );
    expect(localInputValueToIso(value)).toBeNull();
  });

  it('accepts valid local times adjacent to the DST gap', () => {
    const gap = findSpringForwardGap();
    if (!gap) {
      expect(localInputValueToIso('2026-01-15T08:09')).not.toBeNull();
      return;
    }
    const beforeValue = toLocalInput(
      gap.year,
      gap.month1,
      gap.day,
      gap.hour - 1,
      gap.minute,
    );
    const afterValue = toLocalInput(
      gap.year,
      gap.month1,
      gap.day,
      gap.hour + 1,
      gap.minute,
    );
    const beforeExpected = new Date(
      gap.year,
      gap.month1 - 1,
      gap.day,
      gap.hour - 1,
      gap.minute,
      0,
      0,
    ).toISOString();
    const afterExpected = new Date(
      gap.year,
      gap.month1 - 1,
      gap.day,
      gap.hour + 1,
      gap.minute,
      0,
      0,
    ).toISOString();

    expect(localInputValueToIso(beforeValue)).toBe(beforeExpected);
    expect(localInputValueToIso(afterValue)).toBe(afterExpected);
  });
});
