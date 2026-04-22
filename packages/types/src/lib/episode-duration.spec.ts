import { describe, expect, it } from 'vitest';
import { formatEpisodeDurationSimple } from './episode-duration.js';

describe('formatEpisodeDurationSimple', () => {
  it('returns null when ended_at is missing', () => {
    expect(
      formatEpisodeDurationSimple('2026-04-22T10:00:00.000Z', null),
    ).toBeNull();
  });

  it('returns null for invalid timestamps', () => {
    expect(formatEpisodeDurationSimple('bad', '2026-04-22T11:00:00.000Z')).toBe(
      null,
    );
    expect(formatEpisodeDurationSimple('2026-04-22T10:00:00.000Z', 'bad')).toBe(
      null,
    );
  });

  it('returns null when ended_at is before started_at', () => {
    expect(
      formatEpisodeDurationSimple(
        '2026-04-22T11:00:00.000Z',
        '2026-04-22T10:59:00.000Z',
      ),
    ).toBeNull();
  });

  it('formats minutes, hours, and days with simple wording', () => {
    expect(
      formatEpisodeDurationSimple(
        '2026-04-22T10:00:00.000Z',
        '2026-04-22T10:05:00.000Z',
      ),
    ).toBe('5 minutes');
    expect(
      formatEpisodeDurationSimple(
        '2026-04-22T10:00:00.000Z',
        '2026-04-22T11:05:00.000Z',
      ),
    ).toBe('1 hour 5 minutes');
    expect(
      formatEpisodeDurationSimple(
        '2026-04-22T10:00:00.000Z',
        '2026-04-23T12:01:00.000Z',
      ),
    ).toBe('1 day 2 hours 1 minute');
  });

  it('returns less than one minute for short spans', () => {
    expect(
      formatEpisodeDurationSimple(
        '2026-04-22T10:00:00.000Z',
        '2026-04-22T10:00:40.000Z',
      ),
    ).toBe('Less than 1 minute');
  });
});
