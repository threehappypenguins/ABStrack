import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import {
  isPractitionerMfaDeviceTrustActive,
  PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
  practitionerSignOut,
  practitionerSignOutEverywhere,
  tryRestoreTrustedMfaSession,
} from './practitioner-device-trust';

type BrowserClient = AbstrackSupabaseClient;

function buildBundleJson(userId: string, trustedUntilMs: number) {
  return JSON.stringify({
    userId,
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
        setSession: jest.fn(),
        signOut: jest.fn(),
        mfa: {},
      },
    } as unknown as BrowserClient;

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
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

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
      access_token: 'access',
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

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
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

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValueOnce({
            data: { session: sessionForUser(otherId) },
          }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledTimes(2);
    expect(setSession).toHaveBeenNthCalledWith(1, {
      refresh_token: 'refresh',
      access_token: 'access',
    });
    expect(setSession).toHaveBeenNthCalledWith(2, {
      refresh_token: 'pre-refresh',
      access_token: 'pre-access',
    });
    expect(signOut).not.toHaveBeenCalled();
  });

  it('clears the trust bundle when there is no session after setSession and reverts', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValueOnce({
            data: { session: null },
          }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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
        setSession,
        signOut,
        getSession: jest.fn().mockResolvedValue({
          error: new Error('getSession failed'),
          data: { session: null },
        }),
      },
    } as unknown as BrowserClient;

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(setSession).not.toHaveBeenCalled();
    expect(signOut).toHaveBeenCalled();
  });

  it('clears the trust bundle and reverts when getSession fails after setSession', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
        setSession,
        signOut,
        getSession: jest
          .fn()
          .mockResolvedValueOnce({
            error: null,
            data: { session: prePasswordSession(userId) },
          })
          .mockResolvedValueOnce({
            error: new Error('cookie unreadable'),
            data: { session: null },
          }),
        mfa: {
          getAuthenticatorAssuranceLevel: jest.fn(),
        },
      },
    } as unknown as BrowserClient;

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
    expect(setSession).toHaveBeenCalledWith({
      refresh_token: 'refresh',
      access_token: 'access',
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

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
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

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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

    const setSession = jest.fn().mockResolvedValue({ error: null });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
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

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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

    const setSession = jest
      .fn()
      .mockResolvedValueOnce({ error: null })
      .mockResolvedValueOnce({
        error: { message: 'revert failed' },
      });
    const signOut = jest.fn().mockResolvedValue({ error: null });

    const supabase = {
      auth: {
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

    await expect(tryRestoreTrustedMfaSession(supabase, userId)).resolves.toBe(
      false,
    );
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
      if (text.includes('Not implemented: navigation')) {
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

  it('soft sign-out: calls auth.signOut with local scope, keeps MFA bundle', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const signOut = jest.fn().mockResolvedValue({ error: null });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: {
            session: sessionForUser(userId),
          },
        }),
        signOut,
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(
      localStorage.getItem(PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY),
    ).not.toBeNull();
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
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

  it('falls back to server logout when local sign-out returns an error', async () => {
    localStorage.setItem(
      PRACTITIONER_MFA_TRUST_BUNDLE_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );
    localStorage.setItem('sb-proj-auth-token', '{"x":1}');

    const submitSpy = jest
      .spyOn(HTMLFormElement.prototype, 'submit')
      .mockImplementation(() => undefined);

    const signOut = jest
      .fn()
      .mockResolvedValue({ error: { message: 'local sign-out failed' } });
    const supabase = {
      auth: {
        getSession: jest.fn().mockResolvedValue({
          data: {
            session: sessionForUser(userId),
          },
        }),
        signOut,
      },
    } as unknown as BrowserClient;

    await practitionerSignOut(supabase);

    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });
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
