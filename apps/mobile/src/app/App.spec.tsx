import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import NetInfo from '@react-native-community/netinfo';
import type { NetInfoState } from '@react-native-community/netinfo';
import { AppState, Linking } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import type { AbstrackSupabaseClient, Session } from '@abstrack/supabase';

import App from './App';
import { completeCaretakerInviteAfterAuth } from '../lib/caretaker-invite-complete';
import {
  createMobileSupabaseClient,
  getMobileSupabaseClient,
} from '../lib/supabase-wiring';
import * as mobilePhiHook from '../lib/auth/use-mobile-phi-subject-user-context';
import * as mobileNetinfo from '../lib/network/mobile-device-netinfo';

jest.mock('@abstrack/supabase', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/supabase')>(
      '@abstrack/supabase',
    );
  return {
    ...actual,
    getActiveEpisodeForUser: jest.fn().mockResolvedValue({
      ok: true,
      data: null,
    }),
  };
});

jest.mock('../lib/supabase-wiring-core', () => {
  const original = jest.requireActual('../lib/supabase-wiring-core');
  return {
    ...original,
    getMobileSupabaseClient: jest.fn(),
  };
});

jest.mock('../lib/caretaker-invite-complete', () => ({
  completeCaretakerInviteAfterAuth: jest.fn(async () => ({ ok: true })),
}));

const ENV_KEYS = [
  'EXPO_PUBLIC_SUPABASE_URL',
  'EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'EXPO_PUBLIC_USER_WEB_ORIGIN',
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

  beforeEach(() => {
    // Cases that need a custom graph override `fetch` in the same test. Default stays a fast,
    // resolved online snapshot so `App` bootstrap / `fetchMobileDeviceIsConnected` never stall CI.
    jest.mocked(NetInfo.fetch).mockResolvedValue({
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
    } as unknown as NetInfoState);
  });

  /**
   * Supabase registers multiple `onAuthStateChange` listeners (e.g. App). Tests must
   * broadcast to every subscriber; a single stored callback misses App when Home overwrites it.
   */
  function multiSubscriberOnAuthStateChange() {
    const callbacks: Array<(event: string, session: Session | null) => void> =
      [];
    const onAuthStateChange = jest.fn((callback) => {
      callbacks.push(callback);
      return {
        data: {
          subscription: {
            unsubscribe: jest.fn(),
          },
        },
      };
    });
    const emitAuth = (event: string, session: Session | null) => {
      for (const cb of callbacks) {
        cb(event, session);
      }
    };
    return { onAuthStateChange, emitAuth };
  }

  test('returns to Login after SIGNED_OUT even if auth route was Signup', async () => {
    const { onAuthStateChange, emitAuth } = multiSubscriberOnAuthStateChange();

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        onAuthStateChange,
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
      emitAuth('SIGNED_IN', {
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
      emitAuth('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(getByText('Need an account? Sign up')).toBeTruthy();
      expect(queryByText('Already have an account? Login')).toBeNull();
    });
  });

  test('switches between auth stack and main stack from auth events', async () => {
    const { onAuthStateChange, emitAuth } = multiSubscriberOnAuthStateChange();

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({ data: { session: null } })),
        onAuthStateChange,
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { getByText, queryByText } = render(<App />);

    await waitFor(() => {
      expect(getByText('Login')).toBeTruthy();
    });

    expect(onAuthStateChange).toHaveBeenCalled();

    await act(async () => {
      emitAuth('SIGNED_IN', {
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
      emitAuth('SIGNED_OUT', null);
    });

    await waitFor(() => {
      expect(getByText('Login')).toBeTruthy();
      expect(queryByText('Welcome to ABStrack')).toBeNull();
    });
  });

  test('caretaker invite deep link exchanges code and completes invite', async () => {
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
        'abstrack:///caretaker-invite?code=caretaker-invite-code',
      );

    render(<App />);

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith(
        'caretaker-invite-code',
      );
    });
    await waitFor(() => {
      expect(completeCaretakerInviteAfterAuth).toHaveBeenCalled();
    });

    getInitialUrlSpy.mockRestore();
  });

  test('caretaker HTTPS App Link exchanges code and completes invite', async () => {
    process.env.EXPO_PUBLIC_USER_WEB_ORIGIN = 'https://invite.example.com';

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
        'https://invite.example.com/auth/callback?code=https-invite-code&next=%2Fcaretaker%2Fjoin',
      );

    render(<App />);

    await waitFor(() => {
      expect(exchangeCodeForSession).toHaveBeenCalledWith('https-invite-code');
    });
    await waitFor(() => {
      expect(completeCaretakerInviteAfterAuth).toHaveBeenCalled();
    });

    getInitialUrlSpy.mockRestore();
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

    /** After `signOut`, bootstrap’s post–re-auth `getSession` must see null (matches real GoTrue). */
    let persistedSession: Session | null = signedInSession;

    const signOut = jest.fn(async () => {
      persistedSession = null;
      authStateListener?.('SIGNED_OUT', null);
      return { error: null };
    });

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: persistedSession },
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

  test('navigates to symptom and health marker preset screens from tabs', async () => {
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
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
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
      from: jest.fn((table: string) => {
        if (table === 'symptom_presets') {
          return {
            select: jest.fn(() => ({
              order: jest.fn(() => ({
                order: jest.fn(() =>
                  Promise.resolve({ data: [], error: null }),
                ),
              })),
            })),
          };
        }
        if (table === 'profiles') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() =>
                  Promise.resolve({
                    data: { app_role: 'patient' },
                    error: null,
                  }),
                ),
              })),
            })),
          };
        }
        return {
          select: jest.fn(() => ({
            order: jest.fn(() => ({
              order: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('false');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    /** `App` bootstrap awaits `Linking.getInitialURL()`; an unmocked native impl can hang past CI’s async test budget. */
    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(null);
    try {
      const { findByText, findByLabelText, findByTestId } = render(<App />);

      expect(await findByText('Welcome to ABStrack')).toBeTruthy();

      fireEvent.press(await findByLabelText('Symptom presets'));
      expect(await findByTestId('symptom-preset-list-screen')).toBeTruthy();

      fireEvent.press(await findByLabelText('Health marker presets'));
      expect(
        await findByTestId('health-marker-preset-list-screen'),
      ).toBeTruthy();

      fireEvent.press(await findByLabelText('Episode templates'));
      expect(await findByTestId('episode-template-list-screen')).toBeTruthy();
    } finally {
      getInitialUrlSpy.mockRestore();
    }
  });

  test('opens episode start shell from home episode CTA', async () => {
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
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
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
      from: jest.fn((table: string) => {
        if (table === 'symptom_presets') {
          return {
            select: jest.fn(() => ({
              order: jest.fn(() => ({
                order: jest.fn(() =>
                  Promise.resolve({ data: [], error: null }),
                ),
              })),
            })),
          };
        }
        if (table === 'profiles') {
          return {
            select: jest.fn(() => ({
              eq: jest.fn(() => ({
                maybeSingle: jest.fn(() =>
                  Promise.resolve({
                    data: { app_role: 'patient' },
                    error: null,
                  }),
                ),
              })),
            })),
          };
        }
        return {
          select: jest.fn(() => ({
            order: jest.fn(() => ({
              order: jest.fn(() => Promise.resolve({ data: [], error: null })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('false');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    /**
     * Home `activeEpisodeLoading` stays true until PHI scope and the network active-episode probe
     * finish. Spy the hook (not only `resolveMobilePhiSubjectUserContext`) so CI does not burn the
     * full `asyncUtilTimeout` waiting on async auth/NetInfo/focus-effect ordering.
     */
    const phiHookSpy = jest
      .spyOn(mobilePhiHook, 'useMobilePhiSubjectUserContext')
      .mockReturnValue({
        loading: false,
        errorMessage: null,
        authUserId: 'user-1',
        phiSubjectUserId: 'user-1',
        profileAppRole: 'patient',
        refresh: jest.fn(),
      });
    const netConnectedSpy = jest
      .spyOn(mobileNetinfo, 'fetchMobileDeviceIsConnected')
      .mockResolvedValue(true);

    /** Same as tab navigation test: cold `App` bootstrap must not await an unresolved `getInitialURL()`. */
    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue(null);
    try {
      const { findByText, findByTestId, findByLabelText, queryByText } =
        render(<App />);

      await findByText('Welcome to ABStrack');

      // Wait for Home to leave the active-episode probe spinner, then the start CTA (not resume).
      await waitFor(() => {
        expect(
          queryByText('Checking for an episode in progress…'),
        ).toBeNull();
      });
      const startEpisodeButton = await findByLabelText("I'm having an episode");

      fireEvent.press(startEpisodeButton);
      expect(await findByTestId('episode-start-screen-title')).toBeTruthy();
    } finally {
      getInitialUrlSpy.mockRestore();
      phiHookSpy.mockRestore();
      netConnectedSpy.mockRestore();
    }
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

  test('enforces re-auth when app returns to foreground and preference is enabled', async () => {
    let appStateListener: ((state: string) => void) | null = null;
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((eventType, listener) => {
        if (eventType === 'change') {
          appStateListener = listener as (state: string) => void;
        }

        return {
          remove: jest.fn(),
        } as unknown as ReturnType<typeof AppState.addEventListener>;
      });

    const { onAuthStateChange, emitAuth } = multiSubscriberOnAuthStateChange();

    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const signOut = jest.fn(async () => {
      emitAuth('SIGNED_OUT', null);
      return { error: null };
    });

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
          error: null,
        })),
        signOut,
        onAuthStateChange,
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);
    let reauthPreferenceReads = 0;
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'abstrack.theme_preference') {
        return null;
      }
      if (key === 'abstrack.require_reauth_on_open') {
        reauthPreferenceReads += 1;
        // Bootstrap read: off so the user stays signed in; second read (foreground): on.
        return reauthPreferenceReads >= 2 ? 'true' : 'false';
      }
      return null;
    });

    const { findByText } = render(<App />);

    expect(await findByText('You are signed in.')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();

    await act(async () => {
      appStateListener?.('active');
    });

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });

    expect(await findByText('Need an account? Sign up')).toBeTruthy();

    addEventListenerSpy.mockRestore();
  });

  test('uses local signOut for re-auth when foregrounding offline and skips refreshSession', async () => {
    let appStateListener: ((state: string) => void) | null = null;
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((eventType, listener) => {
        if (eventType === 'change') {
          appStateListener = listener as (state: string) => void;
        }

        return {
          remove: jest.fn(),
        } as unknown as ReturnType<typeof AppState.addEventListener>;
      });

    const { onAuthStateChange, emitAuth } = multiSubscriberOnAuthStateChange();

    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const signOut = jest.fn(async () => {
      emitAuth('SIGNED_OUT', null);
      return { error: null };
    });
    const refreshSession = jest.fn(async () => ({ data: {}, error: null }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
          error: null,
        })),
        signOut,
        refreshSession,
        onAuthStateChange,
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);
    let reauthPreferenceReads = 0;
    jest.mocked(SecureStore.getItemAsync).mockImplementation(async (key) => {
      if (key === 'abstrack.theme_preference') {
        return null;
      }
      if (key === 'abstrack.require_reauth_on_open') {
        reauthPreferenceReads += 1;
        return reauthPreferenceReads >= 2 ? 'true' : 'false';
      }
      return null;
    });

    const onlineNet = {
      type: 'wifi',
      isConnected: true,
      isInternetReachable: true,
      details: {},
    } as unknown as NetInfoState;
    const offlineNet = {
      type: 'none',
      isConnected: false,
      isInternetReachable: false,
      details: {},
    } as unknown as NetInfoState;

    let netFetchCount = 0;
    jest.mocked(NetInfo.fetch).mockImplementation(() => {
      netFetchCount += 1;
      if (netFetchCount === 1) {
        return Promise.resolve(onlineNet);
      }
      return Promise.resolve(offlineNet);
    });

    const { findByText } = render(<App />);

    expect(await findByText('You are signed in.')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();

    await act(async () => {
      appStateListener?.('active');
    });

    await waitFor(() => {
      expect(netFetchCount).toBeGreaterThanOrEqual(2);
    });

    await waitFor(() => {
      expect(signOut).toHaveBeenCalledTimes(1);
    });
    expect(signOut).toHaveBeenCalledWith({ scope: 'local' });

    await act(async () => {
      await new Promise<void>((resolve) => setTimeout(resolve, 500));
    });

    expect(refreshSession).not.toHaveBeenCalled();

    jest
      .mocked(NetInfo.fetch)
      .mockImplementation(() => Promise.resolve(onlineNet));
    addEventListenerSpy.mockRestore();
  });

  test('does not enforce re-auth during recovery flow when app becomes active', async () => {
    let appStateListener: ((state: string) => void) | null = null;
    const addEventListenerSpy = jest
      .spyOn(AppState, 'addEventListener')
      .mockImplementation((eventType, listener) => {
        if (eventType === 'change') {
          appStateListener = listener as (state: string) => void;
        }

        return {
          remove: jest.fn(),
        } as unknown as ReturnType<typeof AppState.addEventListener>;
      });

    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const signOut = jest.fn(async () => ({ error: null }));
    const exchangeCodeForSession = jest.fn(async () => ({ error: null }));

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
        })),
        exchangeCodeForSession,
        setSession: jest.fn(async () => ({ error: null })),
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

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('true');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const getInitialUrlSpy = jest
      .spyOn(Linking, 'getInitialURL')
      .mockResolvedValue('abstrack:///update-password?code=abc&type=recovery');

    const { findByText } = render(<App />);

    expect(await findByText('Set new password')).toBeTruthy();
    expect(exchangeCodeForSession).toHaveBeenCalledWith('abc');
    expect(signOut).not.toHaveBeenCalled();

    await act(async () => {
      appStateListener?.('active');
    });

    await waitFor(() => {
      expect(signOut).not.toHaveBeenCalled();
    });

    getInitialUrlSpy.mockRestore();
    addEventListenerSpy.mockRestore();
  });

  test('treats re-auth preference as off when preference read fails', async () => {
    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const signOut = jest.fn(async () => ({ error: null }));
    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

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

    jest
      .mocked(SecureStore.getItemAsync)
      .mockRejectedValue(new Error('secure store read failed'));
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { findByText } = render(<App />);

    expect(await findByText('You are signed in.')).toBeTruthy();
    expect(signOut).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  test('does not crash when sign out fails while enforcing re-auth', async () => {
    const signedInSession = {
      access_token: 'access',
      refresh_token: 'refresh',
      token_type: 'bearer',
      expires_in: 3600,
      expires_at: 9999999999,
      user: { id: 'user-1' },
    } as unknown as Session;

    const warnSpy = jest
      .spyOn(console, 'warn')
      .mockImplementation(() => undefined);

    const mockClient = {
      auth: {
        getSession: jest.fn(async () => ({
          data: { session: signedInSession },
        })),
        signOut: jest.fn(async () => {
          throw new Error('network error');
        }),
        onAuthStateChange: jest.fn(() => ({
          data: {
            subscription: {
              unsubscribe: jest.fn(),
            },
          },
        })),
      },
    } as unknown as AbstrackSupabaseClient;

    jest.mocked(SecureStore.getItemAsync).mockResolvedValue('true');
    jest.mocked(getMobileSupabaseClient).mockReturnValue(mockClient);

    const { findByText } = render(<App />);

    expect(await findByText('You are signed in.')).toBeTruthy();
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});
