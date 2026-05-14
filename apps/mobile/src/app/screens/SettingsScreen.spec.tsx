import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';

import * as practitionerEdge from '../../lib/patient-practitioner-edge-api';
import { getMobileAuthSessionSafe } from '../../lib/supabase-wiring';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { SettingsScreen } from './SettingsScreen';

jest.mock('../../lib/patient-practitioner-edge-api', () => {
  const actual = jest.requireActual<
    typeof import('../../lib/patient-practitioner-edge-api')
  >('../../lib/patient-practitioner-edge-api');
  return {
    ...actual,
    resolvePatientPractitionerAccessUrl: jest.fn(),
    fetchPractitionerAccessGet: jest.fn(),
    fetchPractitionerAccessPostInvite: jest.fn(),
    fetchPractitionerAccessResendInvite: jest.fn(),
    fetchPractitionerAccessRevoke: jest.fn(),
  };
});

/**
 * Mock the wiring barrel so {@link SettingsScreen} never pulls the real secure-store graph, and so
 * this file does **not** replace `../../lib/supabase-wiring` with a partial export (Jest shares one
 * module instance across suites — a minimal factory would drop `getMobileSupabaseClient` and break
 * {@link EpisodesManagementPanel} / other screens in the same worker).
 */
jest.mock('../../lib/supabase-wiring', () => ({
  __esModule: true,
  getMobileSupabaseClient: jest.fn(() => ({
    mockClient: true,
    auth: {
      storageKey: 'sb-test-auth-token',
      getUser: jest.fn(async () => ({
        data: { user: { id: 'user-1' } },
      })),
      getSession: jest.fn(async () => ({
        data: { session: { user: { id: 'user-1' } } },
      })),
    },
  })),
  getMobileAuthSessionSafe: jest.fn(async () => ({
    data: { session: { user: { id: 'user-1' } } },
    error: null,
  })),
  readPersistedMobileAuthUserId: jest.fn(async () => 'user-1'),
  mobileAuthStorage: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => undefined),
    removeItem: jest.fn(async () => undefined),
  },
  createMobileSupabaseClient: jest.fn(() => {
    throw new Error(
      'createMobileSupabaseClient not used in SettingsScreen tests',
    );
  }),
}));

jest.mock('@react-navigation/native', () => {
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: () => ({
      navigate: jest.fn(),
    }),
  };
});

jest.mock('../reauth-preference', () => ({
  getRequireReauthOnOpenPreference: jest.fn(() => Promise.resolve(false)),
  setRequireReauthOnOpenPreference: jest.fn(() => Promise.resolve()),
}));

jest.mock('../theme/AppThemeContext', () => ({
  useAppTheme: jest.fn(),
}));

describe('SettingsScreen', () => {
  const mockSetThemePreference = jest.fn(() => Promise.resolve());

  beforeEach(() => {
    mockSetThemePreference.mockReset();
    mockSetThemePreference.mockResolvedValue(undefined);
    jest.mocked(useAppTheme).mockReturnValue({
      colorScheme: 'light',
      colors: lightAppColors,
      themePreference: 'system',
      setThemePreference: mockSetThemePreference,
      navigationTheme: DefaultTheme,
      statusBarStyle: 'dark',
    });
    jest
      .mocked(practitionerEdge.resolvePatientPractitionerAccessUrl)
      .mockReset();
    jest
      .mocked(practitionerEdge.resolvePatientPractitionerAccessUrl)
      .mockReturnValue(null);
    jest.mocked(practitionerEdge.fetchPractitionerAccessGet).mockReset();
    jest.mocked(practitionerEdge.fetchPractitionerAccessPostInvite).mockReset();
    jest
      .mocked(practitionerEdge.fetchPractitionerAccessResendInvite)
      .mockReset();
    jest.mocked(practitionerEdge.fetchPractitionerAccessRevoke).mockReset();
    jest.mocked(getMobileAuthSessionSafe).mockReset();
    jest.mocked(getMobileAuthSessionSafe).mockResolvedValue({
      data: { session: { user: { id: 'user-1' } } },
      error: null,
    } as never);
  });

  test('disables theme radios while save is in flight', async () => {
    const releaseRef: { current?: () => void } = {};
    mockSetThemePreference.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          releaseRef.current = resolve;
        }),
    );

    const screen = render(<SettingsScreen />);

    await screen.findByLabelText('Light');

    fireEvent.press(screen.getByLabelText('Light'));

    expect(
      screen.getByLabelText('System').props.accessibilityState?.disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText('Light').props.accessibilityState?.disabled,
    ).toBe(true);
    expect(
      screen.getByLabelText('Dark').props.accessibilityState?.disabled,
    ).toBe(true);

    await act(async () => {
      releaseRef.current?.();
    });

    await waitFor(() => {
      expect(
        screen.getByLabelText('Light').props.accessibilityState?.disabled,
      ).toBe(false);
    });
  });

  test('persists each color theme option when selected', async () => {
    const screen = render(<SettingsScreen />);

    screen.getByLabelText('Light');

    mockSetThemePreference.mockClear();

    const cases: { label: string; value: 'system' | 'light' | 'dark' }[] = [
      { label: 'Light', value: 'light' },
      { label: 'Dark', value: 'dark' },
      { label: 'System', value: 'system' },
    ];

    for (const { label, value } of cases) {
      await act(async () => {
        fireEvent.press(screen.getByLabelText(label));
      });
      await waitFor(() => {
        expect(mockSetThemePreference).toHaveBeenCalledWith(value);
      });
      mockSetThemePreference.mockClear();
    }
  });

  test('shows an error when theme persistence fails', async () => {
    mockSetThemePreference.mockRejectedValueOnce(
      new Error('SecureStore failed'),
    );

    const screen = render(<SettingsScreen />);

    await screen.findByLabelText('Light');

    fireEvent.press(screen.getByLabelText('Dark'));

    await waitFor(() => {
      expect(
        screen.getByText('Unable to save your theme choice. Try again.'),
      ).toBeTruthy();
    });
  });

  describe('Practitioner access', () => {
    const practitionerFunctionsUrl =
      'https://test.supabase.co/functions/v1/patient-practitioner-access';

    describe('when EXPO_PUBLIC_SUPABASE_URL is not resolved (no Edge base URL)', () => {
      beforeEach(() => {
        jest
          .mocked(practitionerEdge.resolvePatientPractitionerAccessUrl)
          .mockReturnValue(null);
      });

      test('shows missing EXPO_PUBLIC_SUPABASE_URL guidance on the practitioner card', () => {
        const screen = render(<SettingsScreen />);

        expect(
          screen.getByText(/patient-practitioner-access \(see repo/i),
        ).toBeTruthy();
        expect(
          screen.queryByLabelText('Send practitioner invite or link'),
        ).toBeNull();
      });
    });

    describe('when practitioner Edge URL is configured', () => {
      beforeEach(() => {
        jest
          .mocked(practitionerEdge.resolvePatientPractitionerAccessUrl)
          .mockReturnValue(practitionerFunctionsUrl);
        jest.mocked(getMobileAuthSessionSafe).mockResolvedValue({
          data: {
            session: {
              access_token: 'test-access-token',
              refresh_token: '',
              expires_in: 3600,
              expires_at: Math.floor(Date.now() / 1000) + 3600,
              token_type: 'bearer',
              user: { id: 'patient-user', app_metadata: {}, user_metadata: {} },
            },
          },
          error: null,
        } as never);
        jest
          .mocked(practitionerEdge.fetchPractitionerAccessGet)
          .mockResolvedValue(
            new Response(JSON.stringify({ grants: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          );
      });

      test('renders practitioner section with invite form after grants load', async () => {
        const screen = render(<SettingsScreen />);

        expect(screen.getByLabelText('Practitioner access')).toBeTruthy();
        expect(screen.getByText('Practitioner access')).toBeTruthy();

        await waitFor(() => {
          expect(screen.getByText('Invite a practitioner')).toBeTruthy();
        });

        expect(
          screen.getByLabelText('Practitioner email', { exact: false }),
        ).toBeTruthy();
        expect(
          screen.getByLabelText('Send practitioner invite or link'),
        ).toBeTruthy();
      });

      test('shows session-expired guidance when practitioner grants GET returns 401', async () => {
        jest
          .mocked(practitionerEdge.fetchPractitionerAccessGet)
          .mockResolvedValue(
            new Response(JSON.stringify({ error: 'jwt expired' }), {
              status: 401,
              headers: { 'Content-Type': 'application/json' },
            }),
          );

        const screen = render(<SettingsScreen />);

        await waitFor(() => {
          expect(
            screen.getByText(
              'Your session expired or is no longer valid. Sign in again to manage practitioner access.',
            ),
          ).toBeTruthy();
        });
      });

      test('surfaces Retry-After style copy when practitioner invite POST returns 429', async () => {
        jest
          .mocked(practitionerEdge.fetchPractitionerAccessPostInvite)
          .mockResolvedValue(
            new Response(
              JSON.stringify({
                error: 'rate_limited',
                retryAfterSeconds: 47,
              }),
              {
                status: 429,
                headers: { 'Content-Type': 'application/json' },
              },
            ),
          );

        const screen = render(<SettingsScreen />);

        await waitFor(() => {
          expect(screen.getByText('Invite a practitioner')).toBeTruthy();
        });

        fireEvent.changeText(
          screen.getByLabelText('Practitioner email', { exact: false }),
          'clinician@hospital.example.com',
        );
        fireEvent.press(
          screen.getByLabelText('Send practitioner invite or link'),
        );

        await waitFor(() => {
          expect(
            screen.getByText(
              'Please wait about 47 seconds before sending another invite.',
            ),
          ).toBeTruthy();
        });
      });
    });
  });
});
