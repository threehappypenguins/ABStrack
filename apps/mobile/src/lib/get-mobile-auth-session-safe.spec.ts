import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';

import {
  getMobileAuthSessionSafe,
  hasUsableSupabaseAccessTokenForNetwork,
  isAuthSessionRecoveryFailure,
  isPersistedSupabaseSessionAccessExpired,
  MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE,
  persistedSessionIdentityWithRedactedAccessJwt,
  readPersistedMobileAuthUserId,
} from './get-mobile-auth-session-safe';
import {
  getMobileSupabaseClient,
  mobileAuthStorage,
} from './supabase-wiring-core';

jest.mock('./supabase-wiring-core', () => ({
  getMobileSupabaseClient: jest.fn(),
  mobileAuthStorage: {
    getItem: jest.fn(),
  },
}));

/** JWT: alg none, payload `{ "exp": exp }` (unverified; tests only). */
function jwtWithExp(exp: number): string {
  const base64 = btoa(JSON.stringify({ exp }))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
  return `eyJhbGciOiJub25lIn0.${base64}.sig`;
}

describe('isPersistedSupabaseSessionAccessExpired', () => {
  const nowSec = 1_700_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(nowSec * 1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns true when JWT exp is in the past even if expires_at is absent', () => {
    const session = {
      access_token: jwtWithExp(nowSec - 60),
      refresh_token: 'r',
      expires_in: 3600,
      token_type: 'bearer',
      user: {} as Session['user'],
    } as Session;
    expect(isPersistedSupabaseSessionAccessExpired(session)).toBe(true);
  });

  it('returns true when expires_at is in the past and JWT is not decodable', () => {
    const session = {
      access_token: 'not-a-jwt',
      refresh_token: 'r',
      expires_in: 3600,
      expires_at: nowSec - 1,
      token_type: 'bearer',
      user: {} as Session['user'],
    } as Session;
    expect(isPersistedSupabaseSessionAccessExpired(session)).toBe(true);
  });

  it('returns false when JWT exp and expires_at are in the future', () => {
    const session = {
      access_token: jwtWithExp(nowSec + 3600),
      refresh_token: 'r',
      expires_in: 3600,
      expires_at: nowSec + 3600,
      token_type: 'bearer',
      user: {} as Session['user'],
    } as Session;
    expect(isPersistedSupabaseSessionAccessExpired(session)).toBe(false);
  });

  it('returns true when JWT exp is past while expires_at is still future (JWT wins)', () => {
    const session = {
      access_token: jwtWithExp(nowSec - 10),
      refresh_token: 'r',
      expires_in: 3600,
      expires_at: nowSec + 3600,
      token_type: 'bearer',
      user: {} as Session['user'],
    } as Session;
    expect(isPersistedSupabaseSessionAccessExpired(session)).toBe(true);
  });
});

describe('hasUsableSupabaseAccessTokenForNetwork', () => {
  const nowSec = 1_700_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(nowSec * 1000);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns false when access_token is empty', () => {
    const session = {
      access_token: '',
      user: { id: 'u1' },
    } as Session;
    expect(hasUsableSupabaseAccessTokenForNetwork(session)).toBe(false);
  });

  it('returns false when JWT is expired', () => {
    const session = {
      access_token: jwtWithExp(nowSec - 1),
      user: { id: 'u1' },
    } as Session;
    expect(hasUsableSupabaseAccessTokenForNetwork(session)).toBe(false);
  });

  it('returns true when JWT is not expired', () => {
    const session = {
      access_token: jwtWithExp(nowSec + 60),
      user: { id: 'u1' },
    } as Session;
    expect(hasUsableSupabaseAccessTokenForNetwork(session)).toBe(true);
  });
});

describe('persistedSessionIdentityWithRedactedAccessJwt', () => {
  it('clears access_token and preserves user', () => {
    const session = {
      access_token: 'secret',
      refresh_token: 'r',
      user: { id: 'u1' } as Session['user'],
    } as Session;
    const next = persistedSessionIdentityWithRedactedAccessJwt(session);
    expect(next.access_token).toBe('');
    expect(next.user.id).toBe('u1');
    expect(next.refresh_token).toBe('r');
    expect(session.access_token).toBe('secret');
  });
});

describe('getMobileAuthSessionSafe', () => {
  const storageKey = 'sb-test-auth-token';
  const nowSec = 1_800_000_000;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(nowSec * 1000);
    jest.mocked(getMobileSupabaseClient).mockReset();
    jest.mocked(mobileAuthStorage.getItem).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns identity session with redacted access_token when persisted JWT exp is already past', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: {
        storageKey,
        getSession: jest.fn().mockRejectedValue(new Error('offline')),
      },
    } as unknown as AbstrackSupabaseClient);
    const persisted = {
      access_token: jwtWithExp(nowSec - 1),
      refresh_token: 'r',
      expires_in: 3600,
      expires_at: nowSec + 10,
      token_type: 'bearer',
      user: { id: 'u1' },
    } as Session;
    jest
      .mocked(mobileAuthStorage.getItem)
      .mockResolvedValue(JSON.stringify(persisted));

    await expect(getMobileAuthSessionSafe()).resolves.toEqual({
      data: {
        session: persistedSessionIdentityWithRedactedAccessJwt(persisted),
      },
      error: null,
    });
    expect(mobileAuthStorage.getItem).toHaveBeenCalledWith(storageKey);
  });

  it('surfaces an error when persisted session cannot be read', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: {
        storageKey,
        getSession: jest
          .fn()
          .mockRejectedValue(new TypeError('Network request failed')),
      },
    } as unknown as AbstrackSupabaseClient);
    jest
      .mocked(mobileAuthStorage.getItem)
      .mockRejectedValue(new Error('secure storage unavailable'));

    const result = await getMobileAuthSessionSafe();
    expect(result.data.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe(
      MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE,
    );
    expect((result.error as Error).cause).toMatchObject({
      recoveryReason: 'persisted_session_read_failed',
    });
  });

  it('surfaces an error when persisted session JSON is invalid', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: {
        storageKey,
        getSession: jest.fn().mockRejectedValue(new Error('offline')),
      },
    } as unknown as AbstrackSupabaseClient);
    jest.mocked(mobileAuthStorage.getItem).mockResolvedValue('{bad json');

    const result = await getMobileAuthSessionSafe();
    expect(result.data.session).toBeNull();
    expect(result.error).toBeInstanceOf(Error);
    expect(result.error?.message).toBe(
      MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE,
    );
    expect((result.error as Error).cause).toMatchObject({
      recoveryReason: 'persisted_session_read_failed',
    });
  });

  it('surfaces an error when persisted session payload fails validation', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: {
        storageKey,
        getSession: jest.fn().mockRejectedValue(new Error('offline')),
      },
    } as unknown as AbstrackSupabaseClient);
    jest
      .mocked(mobileAuthStorage.getItem)
      .mockResolvedValue(
        JSON.stringify({ access_token: '', user: { id: 'u1' } }),
      );

    const result = await getMobileAuthSessionSafe();
    expect(result.data.session).toBeNull();
    expect(result.error?.message).toBe(
      MOBILE_AUTH_SESSION_RECOVERY_USER_MESSAGE,
    );
    expect((result.error as Error).cause).toMatchObject({
      recoveryReason: 'invalid_persisted_session',
    });
  });
});

describe('readPersistedMobileAuthUserId', () => {
  const storageKey = 'sb-test-auth-token';

  beforeEach(() => {
    jest.mocked(mobileAuthStorage.getItem).mockReset();
  });

  it('returns null when auth storageKey is missing', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: {},
    } as unknown as AbstrackSupabaseClient);
    await expect(readPersistedMobileAuthUserId()).resolves.toBeNull();
  });

  it('returns user id from persisted JSON even when access_token is empty', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: { storageKey },
    } as unknown as AbstrackSupabaseClient);
    jest.mocked(mobileAuthStorage.getItem).mockResolvedValue(
      JSON.stringify({
        access_token: '',
        refresh_token: 'r',
        user: { id: 'user-offline-id' },
      }),
    );
    await expect(readPersistedMobileAuthUserId()).resolves.toBe(
      'user-offline-id',
    );
  });

  it('retries once after getItem throws then returns user id', async () => {
    jest.mocked(getMobileSupabaseClient).mockReturnValue({
      auth: { storageKey },
    } as unknown as AbstrackSupabaseClient);
    const sessionJson = JSON.stringify({
      access_token: 'tok',
      refresh_token: 'r',
      user: { id: 'u-retry' },
    });
    jest
      .mocked(mobileAuthStorage.getItem)
      .mockRejectedValueOnce(new Error('secure store busy'))
      .mockResolvedValueOnce(sessionJson);

    await expect(readPersistedMobileAuthUserId()).resolves.toBe('u-retry');
    expect(mobileAuthStorage.getItem).toHaveBeenCalledTimes(2);
  });
});

describe('isAuthSessionRecoveryFailure', () => {
  it('returns true for recovery error code', () => {
    expect(
      isAuthSessionRecoveryFailure({
        code: 'auth_session_recovery_failed',
        message: 'x',
      }),
    ).toBe(true);
  });

  it('returns false for null and unrelated codes', () => {
    expect(isAuthSessionRecoveryFailure(null)).toBe(false);
    expect(isAuthSessionRecoveryFailure({ code: 'invalid_grant' })).toBe(false);
  });
});
