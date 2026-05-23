import type { Session, User } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import { getAccessTokenFromSession, getVerifiedAuthSession } from './auth.js';

const verifiedUser = {
  id: 'user-verified',
  email: 'verified@example.com',
} as User;

function makePersistedSession(overrides?: Partial<Session>): Session {
  return {
    access_token: 'persisted-access',
    refresh_token: 'persisted-refresh',
    expires_in: 3600,
    expires_at: 1_700_000_000,
    token_type: 'bearer',
    user: {
      id: 'stale-session-user',
      aud: 'authenticated',
      role: 'authenticated',
      email: 'stale@example.com',
      email_confirmed_at: null,
      phone: '',
      confirmed_at: null,
      last_sign_in_at: null,
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: '',
      updated_at: '',
      is_anonymous: false,
    },
    ...overrides,
  } as Session;
}

function createAuthMockClient(handlers: {
  getUser?: () => Promise<{
    data: { user: User | null };
    error: Error | null;
  }>;
  getSession?: () => Promise<{
    data: { session: Session | null };
    error: Error | null;
  }>;
}): AbstrackSupabaseClient {
  return {
    auth: {
      getUser: vi.fn(handlers.getUser),
      getSession: vi.fn(handlers.getSession),
    },
  } as unknown as AbstrackSupabaseClient;
}

describe('getAccessTokenFromSession', () => {
  it('returns a trimmed access token when the persisted session has one', async () => {
    const client = createAuthMockClient({
      getSession: async () => ({
        data: {
          session: makePersistedSession({
            access_token: '  trimmed-token  ',
          }),
        },
        error: null,
      }),
    });

    const result = await getAccessTokenFromSession(client);

    expect(result).toEqual({
      accessToken: 'trimmed-token',
      error: null,
    });
    expect(client.auth.getSession).toHaveBeenCalledTimes(1);
  });

  it('returns null when the access token is missing or whitespace-only', async () => {
    const client = createAuthMockClient({
      getSession: async () => ({
        data: { session: makePersistedSession({ access_token: '   ' }) },
        error: null,
      }),
    });

    expect(await getAccessTokenFromSession(client)).toEqual({
      accessToken: null,
      error: null,
    });
  });

  it('returns null when there is no persisted session', async () => {
    const client = createAuthMockClient({
      getSession: async () => ({
        data: { session: null },
        error: null,
      }),
    });

    expect(await getAccessTokenFromSession(client)).toEqual({
      accessToken: null,
      error: null,
    });
  });

  it('returns the getSession error without reading session.user', async () => {
    const sessionError = new Error('session read failed');
    const client = createAuthMockClient({
      getSession: async () => ({
        data: { session: null },
        error: sessionError,
      }),
    });

    expect(await getAccessTokenFromSession(client)).toEqual({
      accessToken: null,
      error: sessionError,
    });
  });
});

describe('getVerifiedAuthSession', () => {
  it('returns signed out when getUser reports AuthSessionMissingError', async () => {
    const missingError = Object.assign(new Error('Auth session missing!'), {
      name: 'AuthSessionMissingError',
    });
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: null },
        error: missingError,
      }),
      getSession: async () => {
        throw new Error('getSession should not run');
      },
    });

    expect(await getVerifiedAuthSession(client)).toEqual({
      data: { user: null, session: null },
      error: null,
    });
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it('returns null user and session when getUser fails with a real error', async () => {
    const userError = new Error('getUser failed');
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: null },
        error: userError,
      }),
      getSession: async () => {
        throw new Error('getSession should not run');
      },
    });

    const result = await getVerifiedAuthSession(client);

    expect(result).toEqual({
      data: { user: null, session: null },
      error: userError,
    });
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it('returns signed out when getUser succeeds with no user', async () => {
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: null },
        error: null,
      }),
      getSession: async () => {
        throw new Error('getSession should not run');
      },
    });

    expect(await getVerifiedAuthSession(client)).toEqual({
      data: { user: null, session: null },
      error: null,
    });
    expect(client.auth.getSession).not.toHaveBeenCalled();
  });

  it('returns signed out when getSession reports AuthSessionMissingError', async () => {
    const missingError = Object.assign(new Error('Auth session missing!'), {
      name: 'AuthSessionMissingError',
    });
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: verifiedUser },
        error: null,
      }),
      getSession: async () => ({
        data: { session: null },
        error: missingError,
      }),
    });

    expect(await getVerifiedAuthSession(client)).toEqual({
      data: { user: null, session: null },
      error: null,
    });
  });

  it('keeps the verified user when getSession fails', async () => {
    const sessionError = new Error('getSession failed');
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: verifiedUser },
        error: null,
      }),
      getSession: async () => ({
        data: { session: null },
        error: sessionError,
      }),
    });

    expect(await getVerifiedAuthSession(client)).toEqual({
      data: { user: verifiedUser, session: null },
      error: sessionError,
    });
  });

  it('returns verified user with null session when persisted session is missing', async () => {
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: verifiedUser },
        error: null,
      }),
      getSession: async () => ({
        data: { session: null },
        error: null,
      }),
    });

    expect(await getVerifiedAuthSession(client)).toEqual({
      data: { user: verifiedUser, session: null },
      error: null,
    });
  });

  it('merges the verified user onto the persisted session', async () => {
    const persisted = makePersistedSession();
    const client = createAuthMockClient({
      getUser: async () => ({
        data: { user: verifiedUser },
        error: null,
      }),
      getSession: async () => ({
        data: { session: persisted },
        error: null,
      }),
    });

    const result = await getVerifiedAuthSession(client);

    expect(result.error).toBeNull();
    expect(result.data.user).toEqual(verifiedUser);
    expect(result.data.session).toEqual({
      ...persisted,
      user: verifiedUser,
    });
    expect(result.data.session?.user.id).toBe('user-verified');
    expect(result.data.session?.access_token).toBe('persisted-access');
  });
});
