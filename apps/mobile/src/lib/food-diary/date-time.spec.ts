import {
  isoToLocalDate,
  isoToLocalTime,
  localDateTimeToIso,
} from './date-time';

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

function toDatePart(year: number, month1: number, day: number): string {
  return `${year}-${pad2(month1)}-${pad2(day)}`;
}

function toTimePart(hour: number, minute: number): string {
  return `${pad2(hour)}:${pad2(minute)}`;
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

describe('food diary mobile date-time helpers', () => {
  it('round-trips local date/time through ISO helpers', () => {
    const datePart = '2026-01-15';
    const timePart = '13:45';
    const iso = localDateTimeToIso(datePart, timePart);

    expect(iso).not.toBeNull();
    expect(isoToLocalDate(iso ?? '')).toBe(datePart);
    expect(isoToLocalTime(iso ?? '')).toBe(timePart);
  });

  it('parses optional seconds in local time', () => {
    const iso = localDateTimeToIso('2026-01-15', '08:09:10');
    const expected = new Date(2026, 0, 15, 8, 9, 10, 0).toISOString();

    expect(iso).toBe(expected);
  });

  it('returns null for invalid or out-of-range date/time parts', () => {
    expect(localDateTimeToIso('', '08:09')).toBeNull();
    expect(localDateTimeToIso('2026-01-15', '')).toBeNull();
    expect(localDateTimeToIso('2026-13-15', '08:09')).toBeNull();
    expect(localDateTimeToIso('2026-02-30', '08:09')).toBeNull();
    expect(localDateTimeToIso('2026-01-15', '24:00')).toBeNull();
    expect(localDateTimeToIso('2026-01-15', '08:60')).toBeNull();
    expect(localDateTimeToIso('2026-01-15', '08:09:99')).toBeNull();
  });

  it('rejects a nonexistent local time in a spring-forward DST gap', () => {
    const gap = findSpringForwardGap();
    if (!gap) {
      expect(localDateTimeToIso('2026-01-15', '08:09')).not.toBeNull();
      return;
    }
    const datePart = toDatePart(gap.year, gap.month1, gap.day);
    const timePart = toTimePart(gap.hour, gap.minute);
    expect(localDateTimeToIso(datePart, timePart)).toBeNull();
  });
});
