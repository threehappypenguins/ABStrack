import {
  userFacingSyncHealthBridgeOrClientError,
  userFacingSyncHealthStatusLine,
} from './sync-health-footer-user-messages';

describe('userFacingSyncHealthBridgeOrClientError', () => {
  it('maps transport failures', () => {
    expect(
      userFacingSyncHealthBridgeOrClientError(
        new Error('Network request failed'),
      ),
    ).toMatch(/couldn't reach the sync service/i);
  });

  it('maps auth-shaped messages', () => {
    expect(
      userFacingSyncHealthBridgeOrClientError(new Error('JWT expired')),
    ).toMatch(/sign-in may need/i);
  });

  it('maps SQLite-shaped messages', () => {
    expect(
      userFacingSyncHealthBridgeOrClientError(
        new Error('SqliteException: database is locked'),
      ),
    ).toMatch(/saved copy of your data/i);
  });

  it('returns generic copy for unknown technical messages', () => {
    expect(
      userFacingSyncHealthBridgeOrClientError(
        new Error('PGRST204: column foo.bar not found in schema cache'),
      ),
    ).toMatch(/sync hit a problem/i);
  });
});

describe('userFacingSyncHealthStatusLine', () => {
  it('returns null for empty input', () => {
    expect(userFacingSyncHealthStatusLine(undefined)).toBeNull();
    expect(userFacingSyncHealthStatusLine('   ')).toBeNull();
  });

  it('passes through short benign status text', () => {
    expect(userFacingSyncHealthStatusLine('Downloading changes')).toBe(
      'Downloading changes',
    );
  });

  it('replaces stack-like or error status text', () => {
    expect(
      userFacingSyncHealthStatusLine(
        'TypeError: undefined is not an object at sync.ts:41',
      ),
    ).toMatch(/technical status/i);
  });
});
