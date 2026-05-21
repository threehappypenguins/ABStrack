import { act, render, screen, waitFor } from '@testing-library/react';
import { AuthProvider, useAuth } from './auth-provider';

const getUserMock = jest.fn();
const signOutMock = jest.fn().mockResolvedValue({ error: null });
const onAuthStateChangeMock = jest.fn();
const unsubscribeMock = jest.fn();

let authStateChangeHandler:
  | ((event: 'SIGNED_IN' | 'SIGNED_OUT' | 'TOKEN_REFRESHED') => void)
  | undefined;

jest.mock('./supabase/browser-client', () => ({
  createBrowserClient: () => ({
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
      signOut: (...args: unknown[]) => signOutMock(...args),
      onAuthStateChange: (handler: typeof authStateChangeHandler) => {
        authStateChangeHandler = handler;
        return onAuthStateChangeMock(handler);
      },
    },
  }),
}));

function AuthProbe() {
  const { session, loading } = useAuth();

  return (
    <div data-testid="auth-state">
      {JSON.stringify({
        loading,
        userId: session?.user?.id ?? null,
        email: session?.user?.email ?? null,
      })}
    </div>
  );
}

function readAuthState() {
  const raw = screen.getByTestId('auth-state').textContent ?? '{}';
  return JSON.parse(raw) as {
    loading: boolean;
    userId: string | null;
    email: string | null;
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

  it('starts with loading false when initialSession is provided', () => {
    render(
      <AuthProvider
        initialSession={{ user: { id: 'user-1', email: 'user@example.com' } }}
      >
        <AuthProbe />
      </AuthProvider>,
    );

    expect(readAuthState()).toEqual({
      loading: false,
      userId: 'user-1',
      email: 'user@example.com',
    });
  });

  it('transitions loading from true to false after initial user bootstrap', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    expect(readAuthState()).toEqual({
      loading: true,
      userId: null,
      email: null,
    });

    await waitFor(() => {
      expect(readAuthState()).toEqual({
        loading: false,
        userId: null,
        email: null,
      });
    });

    expect(getUserMock).toHaveBeenCalledTimes(1);
    expect(onAuthStateChangeMock).toHaveBeenCalledTimes(1);
  });

  it('updates context session when auth state change events fire', async () => {
    getUserMock
      .mockResolvedValueOnce({ data: { user: null } })
      .mockResolvedValueOnce({
        data: {
          user: { id: 'user-123', email: 'patient@example.com' },
        },
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

    await waitFor(() => {
      expect(readAuthState()).toEqual({
        loading: false,
        userId: 'user-123',
        email: 'patient@example.com',
      });
    });

    expect(getUserMock).toHaveBeenCalledTimes(2);
  });

  it('unsubscribes from auth events on unmount', () => {
    getUserMock.mockResolvedValue({ data: { user: null } });

    const { unmount } = render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    unmount();

    expect(unsubscribeMock).toHaveBeenCalledTimes(1);
  });

  it('clears invalid refresh tokens via signOut and still finishes loading', async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: {
        code: 'refresh_token_not_found',
        message: 'Invalid Refresh Token: Refresh Token Not Found',
      },
    });

    render(
      <AuthProvider>
        <AuthProbe />
      </AuthProvider>,
    );

    await waitFor(() => {
      expect(readAuthState().loading).toBe(false);
    });

    expect(signOutMock).toHaveBeenCalledTimes(1);
    expect(readAuthState().userId).toBeNull();
  });
});
