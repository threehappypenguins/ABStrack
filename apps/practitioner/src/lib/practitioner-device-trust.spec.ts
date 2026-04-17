import type { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { tryRestoreTrustedMfaSession } from './practitioner-device-trust';

/** Must match `MFA_TRUST_KEY` in `practitioner-device-trust.ts`. */
const MFA_TRUST_STORAGE_KEY = 'abstrack.practitioner.mfaTrustBundle.v1';

type BrowserClient = ReturnType<typeof getSupabaseBrowserClient>;

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

describe('tryRestoreTrustedMfaSession', () => {
  const userId = '00000000-0000-0000-0000-000000000042';

  beforeEach(() => {
    localStorage.clear();
  });

  it('clears the trust bundle when assurance cannot be read', async () => {
    localStorage.setItem(
      MFA_TRUST_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const supabase = {
      auth: {
        setSession: jest.fn().mockResolvedValue({ error: null }),
        getSession: jest.fn().mockResolvedValue({
          data: { session: sessionForUser(userId) },
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
    expect(localStorage.getItem(MFA_TRUST_STORAGE_KEY)).toBeNull();
  });

  it('clears the trust bundle when current assurance level is not aal2', async () => {
    localStorage.setItem(
      MFA_TRUST_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const supabase = {
      auth: {
        setSession: jest.fn().mockResolvedValue({ error: null }),
        getSession: jest.fn().mockResolvedValue({
          data: { session: sessionForUser(userId) },
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
    expect(localStorage.getItem(MFA_TRUST_STORAGE_KEY)).toBeNull();
  });

  it('clears the trust bundle when restored session user id does not match', async () => {
    localStorage.setItem(
      MFA_TRUST_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const otherId = '99999999-9999-9999-9999-999999999999';

    const supabase = {
      auth: {
        setSession: jest.fn().mockResolvedValue({ error: null }),
        getSession: jest.fn().mockResolvedValue({
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
    expect(localStorage.getItem(MFA_TRUST_STORAGE_KEY)).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
  });

  it('clears the trust bundle when there is no session after setSession', async () => {
    localStorage.setItem(
      MFA_TRUST_STORAGE_KEY,
      buildBundleJson(userId, Date.now() + 60_000),
    );

    const supabase = {
      auth: {
        setSession: jest.fn().mockResolvedValue({ error: null }),
        getSession: jest.fn().mockResolvedValue({
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
    expect(localStorage.getItem(MFA_TRUST_STORAGE_KEY)).toBeNull();
    expect(
      supabase.auth.mfa.getAuthenticatorAssuranceLevel,
    ).not.toHaveBeenCalled();
  });
});
