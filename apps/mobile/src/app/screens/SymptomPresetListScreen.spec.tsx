import * as React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import type { SymptomPresetRow } from '@abstrack/types';

import {
  fetchSymptomPresets,
  getCurrentUserId,
  removeSymptomPreset,
} from '../../lib/symptom-presets/symptom-preset-service';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { SymptomPresetListScreen } from './SymptomPresetListScreen';

jest.mock('@react-navigation/native', () => {
  const React = require('react');
  const actual = jest.requireActual('@react-navigation/native');
  return {
    ...actual,
    useNavigation: jest.fn(),
    useFocusEffect: (fn: () => void) => {
      React.useEffect(() => {
        fn();
      }, [fn]);
    },
  };
});

jest.mock('../theme/AppThemeContext', () => ({
  useAppTheme: jest.fn(),
}));

jest.mock('@abstrack/ui/native', () => {
  const actual = jest.requireActual('@abstrack/ui/native');
  return {
    ...actual,
    announce: jest.fn(),
  };
});

jest.mock('../../lib/symptom-presets/symptom-preset-service', () => ({
  getCurrentUserId: jest.fn(),
  fetchSymptomPresets: jest.fn(),
  removeSymptomPreset: jest.fn(),
}));

const presetMorning: SymptomPresetRow = {
  id: 'preset-morning',
  user_id: 'user-1',
  name: 'Morning',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
};

describe('SymptomPresetListScreen', () => {
  const mockNavigate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useNavigation).mockReturnValue({
      navigate: mockNavigate,
    } as never);

    jest.mocked(useAppTheme).mockReturnValue({
      colorScheme: 'light',
      colors: lightAppColors,
      themePreference: 'system',
      setThemePreference: jest.fn(() => Promise.resolve()),
      navigationTheme: DefaultTheme,
      statusBarStyle: 'dark',
    });

    jest.mocked(getCurrentUserId).mockResolvedValue('user-1');
    jest.mocked(fetchSymptomPresets).mockResolvedValue({ ok: true, data: [] });
    jest
      .mocked(removeSymptomPreset)
      .mockResolvedValue({ ok: true, data: undefined });

    mockNavigate.mockReset();
  });

  test('renders empty state when the user is signed in and has no presets', async () => {
    const screen = render(<SymptomPresetListScreen />);

    expect(
      await screen.findByTestId('symptom-preset-list-screen'),
    ).toBeTruthy();

    await waitFor(() => {
      expect(
        screen.getByText(/You have not created any symptom presets yet/),
      ).toBeTruthy();
    });

    expect(getCurrentUserId).toHaveBeenCalled();
    expect(fetchSymptomPresets).toHaveBeenCalled();
  });

  test('shows signed-out error when getCurrentUserId returns null', async () => {
    jest.mocked(getCurrentUserId).mockResolvedValue(null);

    const screen = render(<SymptomPresetListScreen />);

    await waitFor(() => {
      expect(
        screen.getByText('You need to be signed in to manage symptom presets.'),
      ).toBeTruthy();
    });

    expect(fetchSymptomPresets).not.toHaveBeenCalled();
  });

  test('renders preset rows when data is returned', async () => {
    jest
      .mocked(fetchSymptomPresets)
      .mockResolvedValue({ ok: true, data: [presetMorning] });

    const screen = render(<SymptomPresetListScreen />);

    await waitFor(() => {
      expect(screen.getByText('Morning')).toBeTruthy();
    });

    expect(screen.getByLabelText('Edit preset Morning')).toBeTruthy();
  });

  test('pressing trash opens delete confirmation and removeSymptomPreset runs on confirm', async () => {
    jest
      .mocked(fetchSymptomPresets)
      .mockResolvedValue({ ok: true, data: [presetMorning] });

    const alertSpy = jest.spyOn(Alert, 'alert');

    const screen = render(<SymptomPresetListScreen />);

    await screen.findByText('Morning');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete preset Morning'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this symptom preset?',
      expect.stringContaining('Morning'),
      expect.any(Array),
    );

    const buttons = alertSpy.mock.calls[0][2] as {
      text?: string;
      onPress?: () => void;
    }[];
    const deleteAction = buttons.find((b) => b.text === 'Delete');
    expect(deleteAction?.onPress).toBeDefined();

    await act(async () => {
      deleteAction?.onPress?.();
    });

    await waitFor(() => {
      expect(removeSymptomPreset).toHaveBeenCalledWith('preset-morning');
    });

    await waitFor(() => {
      expect(fetchSymptomPresets).toHaveBeenCalledTimes(2);
    });

    alertSpy.mockRestore();
  });
});
