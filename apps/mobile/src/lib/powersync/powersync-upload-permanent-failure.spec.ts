import { isPowerSyncUploadPermanentServerFailure } from './powersync-upload-permanent-failure';

describe('isPowerSyncUploadPermanentServerFailure', () => {
  it('is false for network transport failures', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure(
        new TypeError('Network request failed'),
      ),
    ).toBe(false);
    expect(
      isPowerSyncUploadPermanentServerFailure(
        Object.assign(new Error('Failed to fetch'), { code: 'unknown' }),
      ),
    ).toBe(false);
  });

  it('is false for JWT / session PostgREST codes (retry after refresh)', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: 'PGRST301',
        message: 'JWT expired',
      }),
    ).toBe(false);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: '401',
        message: 'Unauthorized',
      }),
    ).toBe(false);
  });

  it('is false for 5xx HTTP status', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure({
        message: 'Service Unavailable',
        status: 503,
      }),
    ).toBe(false);
  });

  it('is true for integrity / RLS / PostgREST client errors', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: '23503',
        message:
          'insert or update on table "episode_symptoms" violates foreign key constraint',
      }),
    ).toBe(true);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: '42501',
        message: 'new row violates row-level security policy',
      }),
    ).toBe(true);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: 'PGRST204',
        message: 'Could not find the table',
      }),
    ).toBe(true);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: '42P01',
        message: 'undefined_table',
      }),
    ).toBe(true);
  });

  it('is true for 4xx HTTP status without Postgres code (except 401, 408, and 429)', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure({
        message: 'Bad Request',
        status: 400,
      }),
    ).toBe(true);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        message: 'Unauthorized',
        status: 401,
      }),
    ).toBe(false);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        message: 'Request Timeout',
        status: 408,
      }),
    ).toBe(false);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        message: 'Too Many Requests',
        status: 429,
      }),
    ).toBe(false);
  });

  it('is false for retryable Postgres codes even when HTTP status is 4xx (e.g. 409)', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: '40001',
        message: 'could not serialize access due to concurrent update',
        status: 409,
      }),
    ).toBe(false);
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: '40P01',
        message: 'deadlock detected',
        status: 409,
      }),
    ).toBe(false);
  });

  it('is false for PGRST301 when HTTP status is also a client 4xx', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure({
        code: 'PGRST301',
        message: 'JWT expired',
        status: 403,
      }),
    ).toBe(false);
  });

  it('is false when there is no machine-readable code', () => {
    expect(
      isPowerSyncUploadPermanentServerFailure(new Error('Something broke')),
    ).toBe(false);
  });
});
