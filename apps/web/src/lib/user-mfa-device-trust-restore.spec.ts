import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import {
  tryRestoreTrustedMfaSession,
  USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
} from './user-mfa-device-trust';

jest.mock('@abstrack/supabase', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/supabase')>(
      '@abstrack/supabase',
    );
  return {
    ...actual,
    getVerifiedAuthSession: jest.fn(async (client: AbstrackSupabaseClient) => {
      const userResult = await client.auth.getUser();
      if (userResult.error) {
        return {
          data: { user: null, session: null },
          error: userResult.error,
        };
      }
      const user = userResult.data.user;
      if (!user) {
        return { data: { user: null, session: null }, error: null };
      }
      const sessionResult = await client.auth.getSession();
      if (sessionResult.error) {
        return {
          data: { user, session: null },
          error: sessionResult.error,
        };
      }
      const session = sessionResult.data.session;
      if (!session) {
        return { data: { user, session: null }, error: null };
      }
      return {
        data: { user, session: { ...session, user } },
        error: null,
      };
    }),
  };
});

const prevTrustEnv = process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'];
const prevCspEnv = process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
const prevNodeEnv = process.env['NODE_ENV'];

beforeAll(() => {
  process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'] = 'true';
  process.env['NODE_ENV'] = 'development';
  delete process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
});

afterAll(() => {
  if (prevTrustEnv === undefined) {
    delete process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'];
  } else {
    process.env['NEXT_PUBLIC_USER_MFA_DEVICE_TRUST'] = prevTrustEnv;
  }
  if (prevCspEnv === undefined) {
    delete process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'];
  } else {
    process.env['NEXT_PUBLIC_USER_WEB_CSP_ENFORCE'] = prevCspEnv;
  }
  if (prevNodeEnv === undefined) {
    delete process.env['NODE_ENV'];
  } else {
    process.env['NODE_ENV'] = prevNodeEnv;
  }
});

type BrowserClient = AbstrackSupabaseClient;

function buildBundleJson(userId: string, trustedUntilMs: number) {
  return JSON.stringify({
    userId,
    refresh_token: 'refresh',
    access_token: 'access',
    trustedUntilMs,
  });
}

function prePasswordSession(id: string) {
  return {
    user: { id },
    refresh_token: 'pre-refresh',
    access_token: 'pre-access',
  };
}

function mockGetUserForId(userId: string, callCount = 2) {
  const getUser = jest.fn();
  for (let i = 0; i < callCount; i++) {
    getUser.mockResolvedValueOnce({
      data: { user: { id: userId } },
      error: null,
    });
  }
  getUser.mockResolvedValue({ data: { user: { id: userId } }, error: null });
  return getUser;
}

function mockGetUserOnce(id: string) {
  return jest.fn().mockResolvedValue({
    data: { user: { id } },
    error: null,
  });
}

describe('tryRestoreTrustedMfaSession', () => {
  const userId = '00000000-0000-0000-0000-000000000042';

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns not_restored when no trust bundle exists', async () => {
    const supabase = {
      auth: {
        getSession: jest.fn(),
        refreshSession: jest.fn(),
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('returns not_restored and clears bundle when the trust window expired', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() - 1_000),
    );

    const refreshSession = jest.fn();
    const supabase = {
      auth: { refreshSession },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(localStorage.getItem(USER_MFA_TRUST_BUNDLE_STORAGE_KEY)).toBeNull();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it('returns restored when trust bundle applies and assurance is aal2', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(userId),
        user: { id: userId },
      },
      error: null,
    });
    const supabase = {
      auth: {
        getUser: mockGetUserForId(userId),
        refreshSession,
        setSession: jest.fn().mockResolvedValue({ error: null }),
        signOut: jest.fn(),
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValueOnce({
            data: { session: prePasswordSession(userId) },
          }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
            error: null,
            data: { currentLevel: 'aal2', nextLevel: 'aal2' },
          }),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'restored' });
    expect(refreshSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
    });
  });

  it('clears bundle and returns not_restored when stored bundle user id does not match', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(
        '99999999-9999-9999-9999-999999999999',
        Date.now() + 60_000,
      ),
    );

    const supabase = {
      auth: {
        getSession: jest.fn(),
        refreshSession: jest.fn(),
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(localStorage.getItem(USER_MFA_TRUST_BUNDLE_STORAGE_KEY)).toBeNull();
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('reverts to the password session when refreshSession fails', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: { message: 'invalid refresh token' },
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        getUser: mockGetUserForId(userId),
        refreshSession,
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValueOnce({
          error: null,
          data: { session: prePasswordSession(userId) },
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(localStorage.getItem(USER_MFA_TRUST_BUNDLE_STORAGE_KEY)).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('reverts when assurance is aal1 instead of aal2', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        getUser: mockGetUserForId(userId),
        refreshSession: jest.fn().mockResolvedValue({
          data: {
            session: prePasswordSession(userId),
            user: { id: userId },
          },
          error: null,
        }),
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValueOnce({
          data: { session: prePasswordSession(userId) },
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
            error: null,
            data: { currentLevel: 'aal1', nextLevel: 'aal2' },
          }),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(localStorage.getItem(USER_MFA_TRUST_BUNDLE_STORAGE_KEY)).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out when the initial getUser id does not match the expected user', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const otherId = '99999999-9999-9999-9999-999999999999';
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const setSession = jest.fn();

    const supabase = {
      auth: {
        getUser: mockGetUserOnce(otherId),
        setSession,
        signOut,
        getSession: jest.fn(),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'signed_out' });
    expect(localStorage.getItem(USER_MFA_TRUST_BUNDLE_STORAGE_KEY)).toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it('reverts when restored session user id does not match after refresh', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const otherId = '99999999-9999-9999-9999-999999999999';
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const getUser = jest
      .fn()
      .mockResolvedValueOnce({
        data: { user: { id: userId } },
        error: null,
      })
      .mockResolvedValueOnce({
        data: { user: { id: otherId } },
        error: null,
      });

    const supabase = {
      auth: {
        getUser,
        refreshSession: jest.fn().mockResolvedValue({
          data: {
            session: prePasswordSession(otherId),
            user: { id: otherId },
          },
          error: null,
        }),
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValueOnce({
          data: { session: prePasswordSession(userId) },
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(localStorage.getItem(USER_MFA_TRUST_BUNDLE_STORAGE_KEY)).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out when revert setSession fails after a restore failure', async () => {
    localStorage.setItem(
      USER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const setSession = jest.fn().mockResolvedValue({
      error: { message: 'revert failed' },
    });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        getUser: mockGetUserForId(userId),
        refreshSession: jest.fn().mockResolvedValue({
          data: {
            session: prePasswordSession(userId),
            user: { id: userId },
          },
          error: null,
        }),
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValueOnce({
          data: { session: prePasswordSession(userId) },
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest
            .fn()
            .mockResolvedValue({ error: new Error('network'), data: null }),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'signed_out' });
    expect(signOut).toHaveBeenCalled();
  });
});
