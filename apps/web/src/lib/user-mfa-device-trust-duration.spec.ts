import {
  getTrustedUntilMsForDuration,
  getTrustedUntilMsAfterVerification,
} from './user-mfa-device-trust';

describe('getTrustedUntilMsForDuration', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-22T12:00:00.000Z'));
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('adds 30 days for 30_days', () => {
    const expected =
      Date.parse('2026-05-22T12:00:00.000Z') + 30 * 24 * 60 * 60 * 1000;
    expect(getTrustedUntilMsForDuration('30_days')).toBe(expected);
    expect(getTrustedUntilMsAfterVerification()).toBe(expected);
  });

  it('adds 365 days for 1_year', () => {
    const expected =
      Date.parse('2026-05-22T12:00:00.000Z') + 365 * 24 * 60 * 60 * 1000;
    expect(getTrustedUntilMsForDuration('1_year')).toBe(expected);
  });
});
