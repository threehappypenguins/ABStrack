import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';

import App from './App';
import {
  createMobileSupabaseClient,
  getMobileSupabaseClient,
} from '../lib/supabase-wiring';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(async () => null),
  setItemAsync: jest.fn(async () => undefined),
  deleteItemAsync: jest.fn(async () => undefined),
}));

jest.mock('../lib/supabase-wiring', () => {
  const original = jest.requireActual('../lib/supabase-wiring');
  return {
    ...original,
    getMobileSupabaseClient: jest.fn(),
  };
});

const ENV_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
] as const;
const snapshot: Record<string, string | undefined> = {};

const makeMockClient = () => ({
  auth: {
    getSession: jest.fn(async () => ({ data: { session: null } })),
    signOut: jest.fn(async () => ({ error: null })),
    onAuthStateChange: jest.fn(() => ({
      data: {
        subscription: {
          unsubscribe: jest.fn(),
        },
      },
    })),
  },
});

beforeEach(() => {
  jest.clearAllMocks();

  for (const key of ENV_KEYS) {
    snapshot[key] = process.env[key];
  }

  process.env.EXPO_PUBLIC_SUPABASE_URL =
    process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://example.supabase.co';
  process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? 'sb_publishable_test';

  jest
    .mocked(getMobileSupabaseClient)
    .mockReturnValue(makeMockClient() as unknown as AbstrackSupabaseClient);
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    const value = snapshot[key];
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test('renders correctly', async () => {
  const { findByTestId } = render(<App />);
  expect(
    await findByTestId('auth-email', {
      includeHiddenElements: true,
    }),
  ).toBeTruthy();
});

describe('@abstrack/supabase native factory', () => {
  test('wires with env', () => {
    process.env.EXPO_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    expect(createMobileSupabaseClient()).toBeTruthy();
  });
});

describe('mobile auth state sync', () => {
  const invalidOrExpiredMessage =
    'This reset link is invalid or expired. Request a new one.';

  test('returns to Login after SIGNED_OUT even if auth route was Signup', async () => {
    let authStateListener:
      | ((event: string, session: Session | null) => void)
      | null = null;

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: jest.fn((callback) => {
          authStateListener = callback;
          return {
            data: {
              subscription: {
                unsubscribe: jest.fn(),
              },
            },
          };
        }),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { getByText, queryByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('Need an account? Sign up')).toBeTruthy();
    });

    await act(async () => {
      fireEvent.press(getByText('Need an account? Sign up'));
    });

    await waitFor(() => {
      expect(getByText('Already have an account? Login')).toBeTruthy();
    });

    await act(async () => {
      authStateListener?.('SIGNED_IN', {
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 9999999999,
        user: { id: 'user-1' },
      } as unknown as Session);
    });

    await waitFor(() => {
      expect(getByText('Welcome to ABStrack')).toBeTruthy();
    });

    await act(async () => {
      authStateListener?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(getByText('Need an account? Sign up')).toBeTruthy();
      expect(queryByText('Already have an account? Login')).toBeNull();
    });
  });

  test('switches between auth stack and main stack from auth events', async () => {
    let authStateListener:
      | ((event: string, session: Session | null) => void)
      | null = null;

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        onAuthStateChange: jest.fn((callback) => {
          authStateListener = callback;
          return {
            data: {
              subscription: {
                unsubscribe: jest.fn(),
              },
            },
          };
        }),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { getByText, queryByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('Login')).toBeTruthy();
    });

    expect(authStateListener).toBeTruthy();

    await act(async () => {
      authStateListener?.('SIGNED_IN', {
        access_token: 'access',
        refresh_token: 'refresh',
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: 9999999999,
        user: { id: 'user-1' },
      } as unknown as Session);
    });

    await waitFor(() => {
      expect(getByText('Welcome to ABStrack')).toBeTruthy();
    });

    await act(async () => {
      authStateListener?.('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(getByText('Login')).toBeTruthy();
      expect(queryByText('Welcome to ABStrack')).toBeNull();
    });
  });

  test('does not enter recovery flow for unrelated deep links that only contain code', async () => {
    const exchangeCodeForSession = jest.fn(async () => ({ error: null }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        exchangeCodeForSession,
        setSession: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('abstrack:///signup?code=abc&type=magiclink');

    const { getByText, queryByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('Need an account? Sign up')).toBeTruthy();
    });

    expect(queryByText('Set new password')).toBeNull();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();

    getInitialUrlSpy.mockRestore();
  });

  test('enters recovery flow for recovery links targeting update-password', async () => {
    const exchangeCodeForSession = jest.fn(async () => ({ error: null }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        exchangeCodeForSession,
        setSession: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('abstrack:///update-password?code=abc&type=recovery');

    const { findByText } = render(<App />);

    expect(await findByText('Set new password')).toBeTruthy();
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');

    getInitialUrlSpy.mockRestore();
  });

  test('surfaces provider error from recovery deep links', async () => {
    const exchangeCodeForSession = jest.fn(async () => ({ error: null }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        exchangeCodeForSession,
        setSession: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(
        'abstrack:///update-password?type=recovery&error_description=access_denied',
      );

    const { findByText } = render(<App />);

    expect(await findByText('Set new password')).toBeTruthy();
    expect(await findByText(invalidOrExpiredMessage)).toBeTruthy();
    expect(exchangeCodeForSession).not.toHaveBeenCalled();

    getInitialUrlSpy.mockRestore();
  });

  test('shows invalid/expired message when recovery code exchange fails', async () => {
    const exchangeCodeForSession = jest.fn(async () => ({
      error: { message: 'invalid grant' },
    }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        exchangeCodeForSession,
        setSession: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('abstrack:///update-password?code=abc&type=recovery');

    const { findByText } = render(<App />);

    expect(await findByText('Set new password')).toBeTruthy();
    expect(await findByText(invalidOrExpiredMessage)).toBeTruthy();
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');

    getInitialUrlSpy.mockRestore();
  });

  test('shows invalid/expired message when recovery token session setup fails', async () => {
    const setSession = jest.fn(async () => ({
      error: { message: 'invalid token' },
    }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        exchangeCodeForSession: jest.fn(async () => ({ error: null })),
        setSession,
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(
        'abstrack:///update-password?type=recovery&access_token=access&refresh_token=refresh',
      );

    const { findByText } = render(<App />);

    expect(await findByText('Set new password')).toBeTruthy();
    expect(await findByText(invalidOrExpiredMessage)).toBeTruthy();
    expect(setSession).toHaveBeenCalledWith({
      access_token: 'access',
      refresh_token: 'refresh',
    });

    getInitialUrlSpy.mockRestore();
  });

  test('keeps patients signed in on app open when require re-auth is off', async () => {
    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const signOut = jest.fn(async () => ({ error: null }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
        })),
        signOut,
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('false');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { findByText } = render(<App />);

    expect(await findByText('You are signed in.')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
  });

  test('prompts login on app open when require re-auth is on', async () => {
    let authStateListener:
      | ((event: string, session: Session | null) => void)
      | null = null;

    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const signOut = jest.fn(async () => {
      authStateListener?.('SIGNED_OUT', null);
      return { error: null };
    });

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
        })),
        signOut,
        onAuthStateChange: jest.fn((callback) => {
          authStateListener = callback;
          return {
            data: {
              subscription: {
                unsubscribe: jest.fn(),
              },
            },
          };
        }),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('true');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { findByText } = render(<App />);

    expect(await findByText('Need an account? Sign up')).toBeTruthy();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  test('exposes the re-authentication toggle in settings', async () => {
    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
        })),
        signOut: jest.fn(async () => ({ error: null })),
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('false');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { findByText, findByLabelText } = render(<App />);

    const settingsButton = await findByText('Settings');
    fireEvent.press(settingsButton);

    expect(
      await findByLabelText('Require re-authentication on app open'),
    ).toBeTruthy();
  });
});
