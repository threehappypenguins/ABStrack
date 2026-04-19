import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CommonActions, DefaultTheme } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  listEpisodeSymptomsForEpisode,
  listPresetSymptomsForPreset,
  upsertEpisodeSymptomAnswer,
} from '@abstrack/supabase';
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
  listEpisodeSymptomsForEpisode: jest.fn(),
  upsertEpisodeSymptomAnswer: jest.fn(),
}));

jest.mock('../../lib/supabase-wiring', () => ({
  getMobileSupabaseClient: jest.fn(() => ({
    mockClient: true,
    auth: {
      getUser: jest.fn(async () => ({
        data: { user: { id: 'test-user-1' } },
      })),
    },
  })),
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

  /** Single free-text line for debounce / flush tests. */
  const lineFreeOnly = makeLine('line-ft', 0, 'Notes', 'free_text');

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
    jest.mocked(listEpisodeSymptomsForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
    jest.mocked(upsertEpisodeSymptomAnswer).mockResolvedValue({
      ok: true,
      data: {
        id: 'es-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        preset_symptom_id: lineA.id,
        symptom_name: lineA.symptom_name,
        response_type: 'yes_no',
        response_boolean: null,
        response_severity: null,
        response_text: null,
        sort_order: 0,
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
  });

  test('non-free-text answer triggers upsertEpisodeSymptomAnswer', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    jest.mocked(upsertEpisodeSymptomAnswer).mockClear();

    fireEvent.press(screen.getByText('yes'));

    await waitFor(() => {
      expect(upsertEpisodeSymptomAnswer).toHaveBeenCalledTimes(1);
    });

    expect(upsertEpisodeSymptomAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        line: lineA,
        answer: { type: 'yes_no', value: true },
      }),
    );
  });

  test('free_text changes debounce to a single upsert', async () => {
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineFreeOnly],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    jest.mocked(upsertEpisodeSymptomAnswer).mockClear();

    jest.useFakeTimers();
    try {
      const input = screen.getByLabelText('Notes notes');
      fireEvent.changeText(input, 'a');
      fireEvent.changeText(input, 'ab');
      expect(upsertEpisodeSymptomAnswer).not.toHaveBeenCalled();

      await act(async () => {
        jest.advanceTimersByTime(300);
      });
      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(upsertEpisodeSymptomAnswer).toHaveBeenCalledTimes(1);
      });

      expect(upsertEpisodeSymptomAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ mockClient: true }),
        expect.objectContaining({
          userId: 'test-user-1',
          episodeId,
          line: lineFreeOnly,
          answer: { type: 'free_text', value: 'ab' },
        }),
      );
    } finally {
      jest.useRealTimers();
    }
  });

  test('free_text flush on Next runs upsert without waiting for debounce', async () => {
    const lineAfter = makeLine('line-after', 1, 'Tired', 'yes_no');
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineFreeOnly, lineAfter],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    jest.mocked(upsertEpisodeSymptomAnswer).mockClear();

    jest.useFakeTimers();
    try {
      fireEvent.changeText(screen.getByLabelText('Notes notes'), 'draft');
      expect(upsertEpisodeSymptomAnswer).not.toHaveBeenCalled();

      fireEvent.press(screen.getByLabelText('Next symptom'));

      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(upsertEpisodeSymptomAnswer).toHaveBeenCalledTimes(1);
      });

      expect(upsertEpisodeSymptomAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ mockClient: true }),
        expect.objectContaining({
          answer: { type: 'free_text', value: 'draft' },
        }),
      );
    } finally {
      jest.useRealTimers();
    }

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
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
