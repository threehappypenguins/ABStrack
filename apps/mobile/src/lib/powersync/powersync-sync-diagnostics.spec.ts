import { SyncStatus } from '@powersync/common';

import {
  decodeJwtPayloadUnsafeForDiagnostics,
  fingerprintJwtSubForDiagnostics,
  jwtAudFromPayload,
  summarizePowerSyncFetchCredentialsForLog,
  summarizePowerSyncSyncStatusForLog,
  wrapPowerSyncBackendConnectorWithFetchDiagnostics,
} from './powersync-sync-diagnostics';

describe('jwtAudFromPayload', () => {
  it('returns string aud', () => {
    expect(jwtAudFromPayload({ aud: 'authenticated' })).toBe('authenticated');
  });

  it('returns string array aud', () => {
    expect(jwtAudFromPayload({ aud: ['a', 'b'] })).toEqual(['a', 'b']);
  });
});

describe('decodeJwtPayloadUnsafeForDiagnostics', () => {
  it('parses a standard JWT payload', () => {
    // header: {"alg":"none"}  payload: {"sub":"u1","exp":1700000000,"aud":"authenticated"}
    const token =
      'eyJhbGciOiJub25lIn0.' +
      'eyJzdWIiOiJ1MSIsImV4cCI6MTcwMDAwMDAwMCwiYXVkIjoiYXV0aGVudGljYXRlZCJ9' +
      '.sig';
    expect(decodeJwtPayloadUnsafeForDiagnostics(token)).toEqual({
      sub: 'u1',
      exp: 1700000000,
      aud: 'authenticated',
    });
  });

  it('returns null for non-JWT strings', () => {
    expect(decodeJwtPayloadUnsafeForDiagnostics('not-a-jwt')).toBeNull();
  });
});

describe('fingerprintJwtSubForDiagnostics', () => {
  it('is stable for the same sub', () => {
    expect(fingerprintJwtSubForDiagnostics('user-a')).toBe(
      fingerprintJwtSubForDiagnostics('user-a'),
    );
  });

  it('differs for different subs', () => {
    expect(fingerprintJwtSubForDiagnostics('a')).not.toBe(
      fingerprintJwtSubForDiagnostics('b'),
    );
  });
});

describe('summarizePowerSyncFetchCredentialsForLog', () => {
  it('returns present:false for null', () => {
    expect(summarizePowerSyncFetchCredentialsForLog(null)).toEqual({
      present: false,
    });
  });

  it('includes endpoint host and JWT exp without echoing the token', () => {
    const token =
      'eyJhbGciOiJub25lIn0.' +
      'eyJzdWIiOiJ1MSIsImV4cCI6MTcwMDAwMDAwMCwiYXVkIjoiYXV0aGVudGljYXRlZCJ9' +
      '.sig';
    const summary = summarizePowerSyncFetchCredentialsForLog({
      endpoint: 'https://ps.example.com',
      token,
    });
    expect(summary).toMatchObject({
      present: true,
      endpointHost: 'ps.example.com',
      tokenPartCount: 3,
      jwtAud: 'authenticated',
      jwtSubFingerprint: '0442a7f3eeb6d201',
      jwtExp: 1700000000,
    });
    const json = JSON.stringify(summary);
    expect(json).not.toContain('eyJ');
    expect(json).not.toContain('u1');
  });
});

describe('summarizePowerSyncSyncStatusForLog', () => {
  it('omits error stacks from the summary', () => {
    const status = new SyncStatus({
      connected: true,
      connecting: false,
      hasSynced: false,
      dataFlow: {
        downloading: false,
        uploading: false,
        downloadError: new Error('ws failed'),
      },
    });
    const line = JSON.stringify(summarizePowerSyncSyncStatusForLog(status));
    expect(line).toContain('ws failed');
    expect(line).not.toContain('at ');
  });
});

describe('wrapPowerSyncBackendConnectorWithFetchDiagnostics', () => {
  it('emits a summary for each fetchCredentials call', async () => {
    const lines: string[] = [];
    const inner = {
      fetchCredentials: jest.fn().mockResolvedValue({
        endpoint: 'https://ps.example.com',
        token: 'a.b.c',
      }),
      uploadData: jest.fn(),
    };
    const wrapped = wrapPowerSyncBackendConnectorWithFetchDiagnostics(
      inner,
      (line) => {
        lines.push(line);
      },
    );
    await wrapped.fetchCredentials?.();
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? '{}') as { present: boolean };
    expect(parsed.present).toBe(true);
  });
});
