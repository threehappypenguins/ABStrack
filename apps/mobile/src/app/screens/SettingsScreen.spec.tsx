import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';

import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { SettingsScreen } from './SettingsScreen';

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
});
