import * as React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { CommonActions, DefaultTheme } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import { listPresetSymptomsForPreset } from '@abstrack/supabase';
import { createInitialSymptomPromptSession } from '@abstrack/types';
import type { PresetSymptomRow } from '@abstrack/types';

import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import {
  clearSymptomPromptSession,
  getSymptomPromptSession,
  setSymptomPromptSession,
} from '../../lib/episodes/symptom-prompt-session-store';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { SymptomPromptScreen } from './SymptomPromptScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('@abstrack/supabase', () => ({
  listPresetSymptomsForPreset: jest.fn(),
}));

jest.mock('../../lib/supabase-wiring', () => ({
  getMobileSupabaseClient: jest.fn(() => ({ mockClient: true })),
}));

jest.mock('../../lib/episodes/symptom-prompt-session-store', () => ({
  getSymptomPromptSession: jest.fn(),
  setSymptomPromptSession: jest.fn(),
  clearSymptomPromptSession: jest.fn(),
}));

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

const episodeId = 'episode-1';
const symptomPresetId = 'preset-sym-1';
const symptomPresetIdB = 'preset-sym-2';

function makeLine(
  id: string,
  sortOrder: number,
  symptomName: string,
  responseType: PresetSymptomRow['response_type'],
  presetId: string = symptomPresetId,
): PresetSymptomRow {
  return {
    id,
    preset_id: presetId,
    sort_order: sortOrder,
    symptom_name: symptomName,
    response_type: responseType,
    prompt_instruction: null,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
  };
}

describe('SymptomPromptScreen', () => {
  const mockGoBack = jest.fn();
  const mockDispatch = jest.fn();

  const lineA = makeLine('line-a', 0, 'Nausea', 'yes_no');
  const lineB = makeLine('line-b', 1, 'Headache', 'severity_scale');

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId },
    } as never);

    jest.mocked(useNavigation).mockReturnValue({
      goBack: mockGoBack,
      dispatch: mockDispatch,
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
      .mocked(getSymptomPromptSession)
      .mockReturnValue(createInitialSymptomPromptSession());

    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineA, lineB],
    });
  });

  test('loads symptoms and shows step 1 of N', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    expect(screen.getByText('Nausea')).toBeTruthy();
    expect(listPresetSymptomsForPreset).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      symptomPresetId,
    );
    expect(getMobileSupabaseClient).toHaveBeenCalled();
  });

  test('Next advances step and persists session index', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Next symptom'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });

    expect(screen.getByText('Headache')).toBeTruthy();
    expect(setSymptomPromptSession).toHaveBeenCalledWith(episodeId, {
      activeIndex: 1,
      answers: {},
    });
  });

  test('restores activeIndex from session after load', async () => {
    jest.mocked(getSymptomPromptSession).mockReturnValue({
      activeIndex: 1,
      answers: {},
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });

    expect(screen.getByText('Headache')).toBeTruthy();
  });

  test('Back on step 0 calls navigation.goBack', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByLabelText('Go back to previous screen')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Go back to previous screen'));

    expect(mockGoBack).toHaveBeenCalled();
  });

  test('changing symptomPresetId after completion shows prompting again for new lines', async () => {
    const lineOnly = makeLine(
      'line-only',
      0,
      'Fatigue',
      'yes_no',
      symptomPresetIdB,
    );

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Next symptom'));
    await waitFor(() => {
      expect(screen.getByLabelText('Finish symptom list')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Finish symptom list'));

    await waitFor(() => {
      expect(
        screen.getByText(/You reached the end of your symptom list/),
      ).toBeTruthy();
    });

    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineOnly],
    });
    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId: symptomPresetIdB },
    } as never);

    screen.rerender(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });
    expect(screen.getByText('Fatigue')).toBeTruthy();
    expect(
      screen.queryByText(/You reached the end of your symptom list/),
    ).toBeNull();
    expect(listPresetSymptomsForPreset).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      symptomPresetIdB,
    );
  });

  test('Finish shows completion and Return home clears session and resets stack', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Next symptom'));

    await waitFor(() => {
      expect(screen.getByLabelText('Finish symptom list')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Finish symptom list'));

    await waitFor(() => {
      expect(
        screen.getByText(/You reached the end of your symptom list/),
      ).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Return to home'));

    expect(clearSymptomPromptSession).toHaveBeenCalledWith(episodeId);
    expect(mockDispatch).toHaveBeenCalledWith(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
    );
  });
});
