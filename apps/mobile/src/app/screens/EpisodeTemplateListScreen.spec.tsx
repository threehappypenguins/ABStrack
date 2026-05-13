import * as React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { PresetDataError } from '@abstrack/supabase';
import type { EpisodeTemplateWithPresetsRow } from '@abstrack/types';

import { useMobilePhiSubjectUserContext } from '../../lib/auth/use-mobile-phi-subject-user-context';
import {
  fetchEpisodeTemplates,
  getCurrentUserId,
  removeEpisodeTemplate,
} from '../../lib/episode-templates/episode-template-service';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { EpisodeTemplateListScreen } from './EpisodeTemplateListScreen';

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

jest.mock('../../lib/auth/use-mobile-phi-subject-user-context', () => ({
  useMobilePhiSubjectUserContext: jest.fn(),
}));

jest.mock('../../lib/episode-templates/episode-template-service', () => ({
  getCurrentUserId: jest.fn(),
  fetchEpisodeTemplates: jest.fn(),
  removeEpisodeTemplate: jest.fn(),
}));

const templateRow: EpisodeTemplateWithPresetsRow = {
  id: 'et-1',
  user_id: 'user-1',
  name: 'ABS Episode',
  symptom_preset_id: 'sp-1',
  health_marker_preset_id: 'hm-1',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
  symptom_preset: { id: 'sp-1', name: 'My symptoms' },
  health_marker_preset: { id: 'hm-1', name: 'My markers' },
};

describe('EpisodeTemplateListScreen', () => {
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

    jest
      .mocked(getCurrentUserId)
      .mockResolvedValue({ ok: true, data: 'user-1' });
    jest
      .mocked(fetchEpisodeTemplates)
      .mockResolvedValue({ ok: true, data: [] });
    jest
      .mocked(removeEpisodeTemplate)
      .mockResolvedValue({ ok: true, data: undefined });

    jest.mocked(useMobilePhiSubjectUserContext).mockReturnValue({
      phiSubjectUserId: 'user-1',
      loading: false,
      errorMessage: null,
      authUserId: 'user-1',
      profileAppRole: 'patient',
      refresh: jest.fn(),
    });

    mockNavigate.mockReset();
  });

  test('renders empty state when signed in and there are no templates', async () => {
    const screen = render(<EpisodeTemplateListScreen />);

    expect(
      await screen.findByTestId('episode-template-list-screen'),
    ).toBeTruthy();

    await waitFor(() => {
      expect(
        screen.getByText(
          /Episode templates pair one symptom preset with one health marker preset/,
        ),
      ).toBeTruthy();
    });

    expect(getCurrentUserId).toHaveBeenCalled();
    expect(fetchEpisodeTemplates).toHaveBeenCalledWith(
      expect.objectContaining({ scopeUserId: 'user-1' }),
    );
  });

  test('shows PHI scope error and does not fetch templates when context reports an error', async () => {
    jest.mocked(useMobilePhiSubjectUserContext).mockReturnValue({
      phiSubjectUserId: null,
      loading: false,
      errorMessage: 'Caretaker access is not available for this account.',
      authUserId: 'ct-1',
      profileAppRole: 'caretaker',
      refresh: jest.fn(),
    });

    const screen = render(<EpisodeTemplateListScreen />);

    await waitFor(() => {
      expect(
        screen.getByText('Caretaker access is not available for this account.'),
      ).toBeTruthy();
    });

    expect(fetchEpisodeTemplates).not.toHaveBeenCalled();
  });

  test('shows signed-out message when getCurrentUserId returns no user', async () => {
    jest.mocked(getCurrentUserId).mockResolvedValue({ ok: true, data: null });

    const screen = render(<EpisodeTemplateListScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'You need to be signed in to manage episode templates.',
        ),
      ).toBeTruthy();
    });

    expect(fetchEpisodeTemplates).not.toHaveBeenCalled();
  });

  test('shows auth error message when getCurrentUserId fails', async () => {
    jest.mocked(getCurrentUserId).mockResolvedValue({
      ok: false,
      error: new PresetDataError(
        'network_error',
        'Could not reach the server. Check your connection and try again.',
      ),
    });

    const screen = render(<EpisodeTemplateListScreen />);

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not reach the server. Check your connection and try again.',
        ),
      ).toBeTruthy();
    });

    expect(fetchEpisodeTemplates).not.toHaveBeenCalled();
  });

  test('renders template rows when data is returned', async () => {
    jest
      .mocked(fetchEpisodeTemplates)
      .mockResolvedValue({ ok: true, data: [templateRow] });

    const screen = render(<EpisodeTemplateListScreen />);

    await waitFor(() => {
      expect(screen.getByText('ABS Episode')).toBeTruthy();
    });

    expect(
      screen.getByLabelText(
        'Edit template ABS Episode. Symptoms My symptoms, markers My markers',
      ),
    ).toBeTruthy();
  });

  test('pressing delete opens confirmation and removeEpisodeTemplate runs on confirm, then reloads', async () => {
    jest
      .mocked(fetchEpisodeTemplates)
      .mockResolvedValue({ ok: true, data: [templateRow] });

    const alertSpy = jest.spyOn(Alert, 'alert');

    const screen = render(<EpisodeTemplateListScreen />);

    await screen.findByText('ABS Episode');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Delete template ABS Episode'));
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Delete this episode template?',
      expect.stringContaining('ABS Episode'),
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
      expect(removeEpisodeTemplate).toHaveBeenCalledWith('et-1');
    });

    await waitFor(() => {
      expect(fetchEpisodeTemplates).toHaveBeenCalledTimes(2);
    });

    alertSpy.mockRestore();
  });
});
