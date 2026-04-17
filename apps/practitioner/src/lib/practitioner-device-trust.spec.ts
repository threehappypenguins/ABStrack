import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';
import {
  isPractitionerMfaDeviceTrustActive,
  isPractitionerMfaDeviceTrustEnabled,
  PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
  practitionerSignOut,
  practitionerSignOutEverywhere,
  refreshTrustedMfaBundleBeforePasswordSignIn,
  saveMfaTrustBundle,
  syncMfaTrustBundleAfterTokenRefresh,
  tryRestoreTrustedMfaSession,
} from './practitioner-device-trust';

const prevPractitionerDeviceTrustEnv =
  process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];

beforeAll(() => {
  process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = 'true';
});

afterAll(() => {
  if (prevPractitionerDeviceTrustEnv === undefined) {
    delete process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];
  } else {
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] =
      prevPractitionerDeviceTrustEnv;
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

function buildBundleJsonWithEmail(
  userId: string,
  trustedUntilMs: number,
  email: string,
) {
  return JSON.stringify({
    userId,
    email,
    refresh_token: 'refresh',
    access_token: 'access',
    trustedUntilMs,
  });
}

function sessionForUser(id: string) {
  return {
    user: { id },
  };
}

/** Password session before `setSession(bundle)` — includes tokens used to revert on failure. */
function prePasswordSession(id: string) {
  return {
    user: { id },
    refresh_token: 'pre-refresh',
    access_token: 'pre-access',
  };
}

describe('tryRestoreTrustedMfaSession', () => {
  const userId = '00000000-0000-0000-0000-000000000042';

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns restored when trust bundle applies and assurance is aal2', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
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

  it('clears the trust bundle when stored bundle user id does not match current user', async () => {
    const otherUserId = '99999999-9999-9999-9999-999999999999';
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(otherUserId, Date.now() + 60_000),
    );

    const getSession = jest.fn();
    const supabase = {
      auth: {
        getSession,
        refreshSession: jest.fn(),
        setSession: jest.fn(),
        signOut: jest.fn(),
        mfa: {},
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'not_restored' });
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(getSession).not.toHaveBeenCalled();
  });

  it('clears the trust bundle when assurance cannot be read', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(userId),
        user: { id: userId },
      },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValue({
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
    ).resolves.toEqual({ status: 'not_restored' });
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(refreshSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
    });
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle when current assurance level is not aal2', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(userId),
        user: { id: userId },
      },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValue({
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
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle and signs out when initial session user id does not match', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const otherId = '99999999-9999-9999-9999-999999999999';

    const setSession = jest.fn();
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValue({
          data: { session: prePasswordSession(otherId) },
        }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'signed_out' });
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
  });

  it('clears the trust bundle when restored session user id does not match and reverts session', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const otherId = '99999999-9999-9999-9999-999999999999';

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(otherId),
        user: { id: otherId },
      },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
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
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
    expect(refreshSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
    });
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle when refreshSession returns no session and reverts', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: { session: null, user: null },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
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
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle and signs out when initial getSession fails', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const setSession = jest.fn();
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession: jest.fn(),
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValue({
          error: new Error('getSession failed'),
          data: { session: null },
        }),
      },
    } as unknown as BrowserClient;

    await expect(
      tryRestoreTrustedMfaSession(supabase, userId),
    ).resolves.toEqual({ status: 'signed_out' });
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it('clears the trust bundle and reverts when refreshSession fails', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
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
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
    expect(refreshSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
    });
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle and reverts when final getSession fails after AAL2', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(userId),
        user: { id: userId },
      },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            error: null,
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValueOnce({
            error: new Error('final getSession failed'),
            data: { session: null },
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
    ).resolves.toEqual({ status: 'not_restored' });
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle and reverts when final getSession returns no session after AAL2', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(userId),
        user: { id: userId },
      },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            error: null,
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValueOnce({
            error: null,
            data: { session: null },
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
    ).resolves.toEqual({ status: 'not_restored' });
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('signs out when revert setSession fails after a restore failure', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: prePasswordSession(userId),
        user: { id: userId },
      },
      error: null,
    });
    const setSession = jest.fn().mockResolvedValueOnce({
      error: { message: 'revert failed' },
    });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        refreshSession,
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

describe('stored trust bundle validation', () => {
  const userId = '00000000-0000-0000-0000-000000000099';

  beforeEach(() => {
    localStorage.clear();
  });

  it('removes invalid bundle with empty refresh_token and reports inactive', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      JSON.stringify({
        userId,
        refresh_token: '',
        access_token: 'access',
        trustedUntilMs: Date.now() + 60_000,
      }),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });

  it('removes invalid bundle with NaN trustedUntilMs', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      JSON.stringify({
        userId,
        refresh_token: 'refresh',
        access_token: 'access',
        trustedUntilMs: Number.NaN,
      }),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });

  it('removes invalid bundle when expires_at is non-finite', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      JSON.stringify({
        userId,
        refresh_token: 'refresh',
        access_token: 'access',
        trustedUntilMs: Date.now() + 60_000,
        expires_at: Number.NaN,
      }),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });

  it('removes invalid bundle with blank userId', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      JSON.stringify({
        userId: '   ',
        refresh_token: 'refresh',
        access_token: 'access',
        trustedUntilMs: Date.now() + 60_000,
      }),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });

  it('removes storage when JSON.parse fails', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      '{"truncated":',
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });
});

describe('isPractitionerMfaDeviceTrustActive', () => {
  const userId = '00000000-0000-0000-0000-000000000099';

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when userId is missing or empty', () => {
    expect(isPractitionerMfaDeviceTrustActive(undefined)).toBe(false);
    expect(isPractitionerMfaDeviceTrustActive('')).toBe(false);
  });

  it('returns false when there is no bundle or user does not match, and clears bundle on mismatch', () => {
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(
        '00000000-0000-0000-0000-000000000001',
        Date.now() + 60_000,
      ),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });

  it('returns false when the trust window has expired and removes the bundle', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() - 1000),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
  });

  it('returns true when a non-expired bundle exists for the user', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(true);
  });
});

describe('practitionerSignOut', () => {
  const userId = '00000000-0000-0000-0000-000000000088';

  /** jsdom does not implement navigation; `practitionerSignOut` calls `location.assign`. */
  const origConsoleError = console.error;
  beforeAll(() => {
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      const text = args
        .map((a) => (a instanceof Error ? a.message : String(a)))
        .join(' ');
      if (
        text.includes('Not implemented: navigation') ||
        text.includes('soft session clear failed')
      ) {
        return;
      }
      origConsoleError.apply(console, args as Parameters<typeof console.error>);
    });
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  beforeEach(() => {
    localStorage.clear();
  });

  it('soft sign-out: clears auth storage without POST /logout, keeps MFA bundle', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const removeItem = jest.fn().mockResolvedValue(undefined);
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: {
            session: sessionForUser(userId),
          },
        }),
        signOut,
        storage: { removeItem },
        storageKey: 'sb-test-auth-token',
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).not.toBeNull();
    expect(signOut).not.toHaveBeenCalled();
    expect(removeItem).toHaveBeenCalledWith('sb-test-auth-token');
    expect(removeItem).toHaveBeenCalledWith('sb-test-auth-token-code-verifier');
    expect(removeItem).toHaveBeenCalledWith('sb-test-auth-token-user');
  });

  it('full sign-out: clears MFA bundle and calls auth.signOut without local scope (expired trust window)', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() - 1000),
    );

    const signOut = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: { session: sessionForUser(userId) },
        }),
        signOut,
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith();
  });

  it('full sign-out when no session: clears bundle and calls auth.signOut', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const signOut = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({ data: { session: null } }),
        signOut,
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith();
  });

  it('falls back to server logout when soft session clear fails', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );
    localStorage.setItem('sb-proj-auth-token', '{"x":1}');

    const submitSpy = jest
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const removeItem = jest
      .fn()
      .mockRejectedValue(new Error('storage remove failed'));
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: {
            session: sessionForUser(userId),
          },
        }),
        signOut,
        storage: { removeItem },
        storageKey: 'sb-test-auth-token',
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(signOut).not.toHaveBeenCalled();
    expect(submitSpy).toHaveBeenCalledTimes(1);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(localStorage.getItem('sb-proj-auth-token')).toBeNull();

    submitSpy.mockRestore();
  });

  it('falls back to server logout when full sign-out returns an error', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() - 1000),
    );

    const submitSpy = jest
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const signOut = jest
      .fn()
      .mockResolvedValue({ error: { message: 'sign-out failed' } });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: { session: sessionForUser(userId) },
        }),
        signOut,
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(signOut).toHaveBeenCalledWith();
    expect(submitSpy).toHaveBeenCalledTimes(1);

    submitSpy.mockRestore();
  });
});

describe('practitionerSignOutEverywhere', () => {
  const userId = '00000000-0000-0000-0000-000000000077';
  let submitSpy: jest.SpyInstance;

  beforeEach(() => {
    localStorage.clear();
    submitSpy = jest
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    submitSpy.mockRestore();
  });

  it('clears MFA bundle, scrubs sb-* localStorage keys, and POSTs logout form', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );
    localStorage.setItem('sb-proj-auth-token', '{"refresh":true}');

    practitionerSignOutEverywhere();

    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(localStorage.getItem('sb-proj-auth-token')).toBeNull();
    expect(submitSpy).toHaveBeenCalledTimes(1);
  });
});

describe('syncMfaTrustBundleAfterTokenRefresh', () => {
  const userId = '00000000-0000-0000-0000-000000000042';

  beforeEach(() => {
    localStorage.clear();
  });

  it('rewrites bundle with rotated tokens when assurance is aal2', async () => {
    const trustedUntil = Date.now() + 86_400_000;
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, trustedUntil),
    );

    const supabase = {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
            data: { currentLevel: 'aal2', nextLevel: null },
            error: null,
          }),
        },
      },
    };

    const session = {
      user: { id: userId },
      refresh_token: 'rotated-refresh',
      access_token: 'rotated-access',
    } as Session;

    await syncMfaTrustBundleAfterTokenRefresh(
      supabase as unknown as BrowserClient,
      session,
    );

    const raw = localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw!) as {
      refresh_token: string;
      access_token: string;
      trustedUntilMs: number;
    };
    expect(parsed.refresh_token).toBe('rotated-refresh');
    expect(parsed.access_token).toBe('rotated-access');
    expect(parsed.trustedUntilMs).toBe(trustedUntil);
  });

  it('does not update bundle when assurance is aal1', async () => {
    const trustedUntil = Date.now() + 86_400_000;
    const initial = buildBundleJson(userId, trustedUntil);
    localStorage.setItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY, initial);

    const supabase = {
      auth: {
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn().mockResolvedValue({
            data: { currentLevel: 'aal1', nextLevel: 'aal2' },
            error: null,
          }),
        },
      },
    };

    const session = {
      user: { id: userId },
      refresh_token: 'pwd-refresh',
      access_token: 'pwd-access',
    } as Session;

    await syncMfaTrustBundleAfterTokenRefresh(
      supabase as unknown as BrowserClient,
      session,
    );

    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBe(initial);
  });
});

describe('refreshTrustedMfaBundleBeforePasswordSignIn', () => {
  const userId = '00000000-0000-0000-0000-000000000042';
  const email = 'doc@example.com';

  beforeEach(() => {
    localStorage.clear();
  });

  it('returns false when there is no bundle', async () => {
    const supabase = {
      auth: {
        refreshSession: jest.fn(),
        signOut: jest.fn(),
        mfa: { getAuthenticatorAssuranceLevel: jest.fn() },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, email),
    ).resolves.toBe(false);
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('returns false when bundle has no email (legacy)', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );
    const supabase = {
      auth: {
        refreshSession: jest.fn(),
        signOut: jest.fn(),
        mfa: { getAuthenticatorAssuranceLevel: jest.fn() },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, email),
    ).resolves.toBe(false);
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('matches email case-insensitively', async () => {
    const trustedUntil = Date.now() + 60_000;
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJsonWithEmail(userId, trustedUntil, 'Doc@Example.COM'),
    );
    const refreshedSession = {
      user: { id: userId, email: 'doc@example.com' },
      refresh_token: 'new-r',
      access_token: 'new-a',
    };
    const refreshSession = jest.fn().mockResolvedValue({
      data: { session: refreshedSession },
      error: null,
    });
    const getAuthenticatorAssuranceLevel = jest.fn().mockResolvedValue({
      error: null,
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });
    const supabase = {
      auth: {
        refreshSession,
        signOut: jest.fn().mockResolvedValue({ error: null }),
        mfa: { getAuthenticatorAssuranceLevel },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, 'doc@example.com'),
    ).resolves.toBe(true);
    expect(refreshSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
    });
  });

  it('returns false when sign-in email does not match bundle email', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJsonWithEmail(
        userId,
        Date.now() + 60_000,
        'other@example.com',
      ),
    );
    const supabase = {
      auth: {
        refreshSession: jest.fn(),
        signOut: jest.fn(),
        mfa: { getAuthenticatorAssuranceLevel: jest.fn() },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, email),
    ).resolves.toBe(false);
    expect(supabase.auth.refreshSession).not.toHaveBeenCalled();
  });

  it('returns false and signs out when refresh succeeds but user id does not match bundle', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJsonWithEmail(userId, Date.now() + 60_000, email),
    );
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: {
          user: { id: '00000000-0000-0000-0000-000000000099' },
          refresh_token: 'new-r',
          access_token: 'new-a',
        },
      },
      error: null,
    });
    const supabase = {
      auth: {
        refreshSession,
        signOut,
        mfa: { getAuthenticatorAssuranceLevel: jest.fn() },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, email),
    ).resolves.toBe(false);
    expect(signOut).toHaveBeenCalled();
  });

  it('returns false and signs out when assurance is not aal2', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJsonWithEmail(userId, Date.now() + 60_000, email),
    );
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const refreshSession = jest.fn().mockResolvedValue({
      data: {
        session: {
          user: { id: userId },
          refresh_token: 'new-r',
          access_token: 'new-a',
        },
      },
      error: null,
    });
    const getAuthenticatorAssuranceLevel = jest.fn().mockResolvedValue({
      error: null,
      data: { currentLevel: 'aal1', nextLevel: 'aal2' },
    });
    const supabase = {
      auth: {
        refreshSession,
        signOut,
        mfa: { getAuthenticatorAssuranceLevel },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, email),
    ).resolves.toBe(false);
    expect(signOut).toHaveBeenCalled();
  });

  it('returns true and persists refreshed session when refresh and aal2 succeed', async () => {
    const trustedUntil = Date.now() + 60_000;
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJsonWithEmail(userId, trustedUntil, email),
    );
    const signOut = jest.fn().mockResolvedValue({ error: null });
    const refreshedSession = {
      user: { id: userId, email },
      refresh_token: 'new-r',
      access_token: 'new-a',
    };
    const refreshSession = jest.fn().mockResolvedValue({
      data: { session: refreshedSession },
      error: null,
    });
    const getAuthenticatorAssuranceLevel = jest.fn().mockResolvedValue({
      error: null,
      data: { currentLevel: 'aal2', nextLevel: 'aal2' },
    });
    const supabase = {
      auth: {
        refreshSession,
        signOut,
        mfa: { getAuthenticatorAssuranceLevel },
      },
    } as unknown as BrowserClient;

    await expect(
      refreshTrustedMfaBundleBeforePasswordSignIn(supabase, email),
    ).resolves.toBe(true);

    const raw = localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as {
      refresh_token: string;
      userId: string;
      email?: string;
    };
    expect(parsed.refresh_token).toBe('new-r');
    expect(parsed.userId).toBe(userId);
    expect(parsed.email).toBe(email);
    expect(signOut).not.toHaveBeenCalled();
  });
});

describe('saveMfaTrustBundle', () => {
  const userId = '00000000-0000-0000-0000-000000000042';

  beforeEach(() => {
    localStorage.clear();
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = 'true';
  });

  it('preserves email from existing bundle when session user omits email (same user id)', () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJsonWithEmail(userId, Date.now() + 60_000, 'keep@example.com'),
    );
    saveMfaTrustBundle(
      {
        user: { id: userId },
        refresh_token: 'new-refresh',
        access_token: 'new-access',
      } as Session,
      Date.now() + 120_000,
    );
    const raw = localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY);
    expect(raw).toBeTruthy();
    const parsed = JSON.parse(raw as string) as {
      email?: string;
      refresh_token: string;
      userId: string;
    };
    expect(parsed.userId).toBe(userId);
    expect(parsed.email).toBe('keep@example.com');
    expect(parsed.refresh_token).toBe('new-refresh');
  });
});

describe('MFA device trust deploy gate', () => {
  const userId = '00000000-0000-0000-0000-000000000042';

  it('reports enabled when env is unset', () => {
    const prev = process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];
    delete process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];
    expect(isPractitionerMfaDeviceTrustEnabled()).toBe(true);
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = prev ?? 'true';
  });

  it('does not write localStorage when disabled', () => {
    const prev = process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = 'false';
    localStorage.clear();
    saveMfaTrustBundle(
      {
        user: { id: userId },
        refresh_token: 'r',
        access_token: 'a',
      } as Session,
      Date.now() + 60_000,
    );
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = prev ?? 'true';
  });

  it('clears existing bundle on read when disabled', () => {
    const prev = process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'];
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = 'false';
    expect(isPractitionerMfaDeviceTrustActive(userId)).toBe(false);
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    process.env['NEXT_PUBLIC_PRACTITIONER_MFA_DEVICE_TRUST'] = prev ?? 'true';
  });
});
