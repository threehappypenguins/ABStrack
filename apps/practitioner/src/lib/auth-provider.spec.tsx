import { act, render, screen, waitFor } from '@testing-library/react';
import type { Session } from '@abstrack/supabase';
import { AuthProvider, useAuth } from './auth-provider';

const getVerifiedAuthSessionMock = jest.fn();
const signOutMock = jest.fn().mockResolvedValue({ error: null });
const onAuthStateChangeMock = jest.fn();
const unsubscribeMock = jest.fn();
const syncMfaTrustBundleAfterTokenRefreshMock = jest
  .fn()
  .mockResolvedValue(undefined);

let authStateChangeHandler:
  | ((
      event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED',
    ) => void | Promise<void>)
  | undefined;

function makeSession(userId: string): Session {
  return {
    access_token: 'access-token',
    refresh_token: 'refresh-token',
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: 'bearer',
    user: {
      id: userId,
      aud: 'authenticated',
      role: 'authenticated',
      email: `${userId}@example.com`,
      email_confirmed_at: new Date().toISOString(),
      phone: '',
      confirmed_at: new Date().toISOString(),
      last_sign_in_at: new Date().toISOString(),
      app_metadata: {},
      user_metadata: {},
      identities: [],
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      is_anonymous: false,
    },
  } as Session;
}

jest.mock('@abstrack/supabase', () => {
  const actual = jest.requireActual('@abstrack/supabase');
  return {
    ...actual,
    getVerifiedAuthSession: (...args: unknown[]) =>
      getVerifiedAuthSessionMock(...args),
    fetchProfileByUserId: jest
      .fn()
      .mockResolvedValue({ data: { app_role: 'practitioner' }, error: null }),
  };
});

jest.mock('@abstrack/supabase/browser', () => ({
  getSupabaseBrowserClient: jest.fn(() => ({
    auth: {
      signOut: (...args: unknown[]) => signOutMock(...args),
      onAuthStateChange: (handler: typeof authStateChangeHandler) => {
        authStateChangeHandler = handler;
        return onAuthStateChangeMock(handler);
      },
    },
  })),
}));

jest.mock('./practitioner-device-trust', () => ({
  syncMfaTrustBundleAfterTokenRefresh: (...args: unknown[]) =>
    syncMfaTrustBundleAfterTokenRefreshMock(...args),
}));

function AuthProbe() {
  const { session, loading } = useAuth();

  return (
    <div data-testid="auth-state">
      {JSON.stringify({
        loading,
        userId: session?.user?.id ?? null,
      })}
    </div>
  );
}

function readAuthState() {
  const raw = screen.getByTestId('auth-state').textContent ?? '{}';
  return JSON.parse(raw) as {
    loading: boolean;
    userId: string | null;
  };
}

describe('AuthProvider', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authStateChangeHandler = undefined;
    onAuthStateChangeMock.mockReturnValue({
      data: { subscription: { unsubscribe: unsubscribeMock } },
    });
  });

  it('does not restore session when SIGNED_OUT invalidates an in-flight SIGNED_IN verify', async () => {
    type VerifiedResult = Awaited<
      ReturnType<typeof getVerifiedAuthSessionMock>
    >;
    let resolveSlow: (value: VerifiedResult) => void;
    const slowVerify = new Promise<VerifiedResult>((resolve) => {
      resolveSlow = resolve;
    });

    getVerifiedAuthSessionMock
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: null,
      })
      .mockReturnValueOnce(slowVerify)
      .mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(readAuthState().loading).toBe(false);
    });

    act(() => {
      authStateChangeHandler?.('SIGNED_IN');
    });
    act(() => {
      authStateChangeHandler?.('SIGNED_OUT');
    });

    expect(readAuthState().userId).toBeNull();

    await act(async () => {
      resolveSlow({
        data: {
          user: makeSession('stale-user').user,
          session: makeSession('stale-user'),
        },
        error: null,
      });
      await slowVerify;
    });

    expect(readAuthState().userId).toBeNull();
  });

  it('does not run MFA trust sync when TOKEN_REFRESHED verify is superseded by SIGNED_OUT', async () => {
    type VerifiedResult = Awaited<
      ReturnType<typeof getVerifiedAuthSessionMock>
    >;
    let resolveSlow: (value: VerifiedResult) => void;
    const slowVerify = new Promise<VerifiedResult>((resolve) => {
      resolveSlow = resolve;
    });

    getVerifiedAuthSessionMock
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: null,
      })
      .mockReturnValueOnce(slowVerify)
      .mockResolvedValue({
        data: { user: null, session: null },
        error: null,
      });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(readAuthState().loading).toBe(false);
    });

    act(() => {
      authStateChangeHandler?.('TOKEN_REFRESHED');
    });
    act(() => {
      authStateChangeHandler?.('SIGNED_OUT');
    });

    await act(async () => {
      resolveSlow({
        data: {
          user: makeSession('stale-user').user,
          session: makeSession('stale-user'),
        },
        error: null,
      });
      await slowVerify;
    });

    expect(readAuthState().userId).toBeNull();
    expect(syncMfaTrustBundleAfterTokenRefreshMock).not.toHaveBeenCalled();
  });

  it('keeps session when MFA trust sync fails after TOKEN_REFRESHED', async () => {
    const session = makeSession('practitioner-1');

    getVerifiedAuthSessionMock
      .mockResolvedValueOnce({
        data: { user: null, session: null },
        error: null,
      })
      .mockResolvedValue({
        data: { user: session.user, session },
        error: null,
      });

    syncMfaTrustBundleAfterTokenRefreshMock.mockRejectedValueOnce(
      new Error('trust bundle storage failed'),
    );

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(readAuthState().loading).toBe(false);
    });

    act(() => {
      authStateChangeHandler?.('TOKEN_REFRESHED');
    });

    await waitFor(() => {
      expect(readAuthState().userId).toBe('practitioner-1');
    });

    expect(signOutMock).not.toHaveBeenCalled();
    expect(syncMfaTrustBundleAfterTokenRefreshMock).toHaveBeenCalledTimes(1);
  });
});
