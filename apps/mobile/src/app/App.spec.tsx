import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
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
    onAuthStateChange: jest.fn(() => ({
      data: {
        subscription: {
          unsubscribe: jest.fn(),
        },
      },
    })),
  },
});

type MockMobileClient = Pick<AbstrackSupabaseClient, 'auth'>;

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
    .mockReturnValue(makeMockClient() as unknown as MockMobileClient);
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
    } as unknown as MockMobileClient;

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
    } as unknown as MockMobileClient;

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
});
