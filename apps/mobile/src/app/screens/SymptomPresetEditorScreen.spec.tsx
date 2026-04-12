import * as React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { PresetSymptomRow, SymptomPresetRow } from '@abstrack/types';

import {
  fetchPresetSymptoms,
  fetchSymptomPresetById,
  saveNewPresetSymptom,
  savePresetSymptomOrder,
} from '../../lib/symptom-presets/symptom-preset-service';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { SymptomPresetEditorScreen } from './SymptomPresetEditorScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
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

jest.mock('../../lib/symptom-presets/symptom-preset-service', () => ({
  fetchSymptomPresetById: jest.fn(),
  fetchPresetSymptoms: jest.fn(),
  saveNewPresetSymptom: jest.fn(),
  saveSymptomPresetName: jest.fn(),
  savePresetSymptom: jest.fn(),
  savePresetSymptomOrder: jest.fn(),
  removePresetSymptom: jest.fn(),
}));

const presetId = 'preset-1';

const presetRow: SymptomPresetRow = {
  id: presetId,
  user_id: 'user-1',
  name: 'Morning',
  created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-01T00:00:00Z',
};

function makeLine(
  id: string,
  sortOrder: number,
  symptomName: string,
): PresetSymptomRow {
  return {
    id,
    preset_id: presetId,
    sort_order: sortOrder,
    symptom_name: symptomName,
    response_type: 'yes_no',
    prompt_instruction: null,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
  };
}

describe('SymptomPresetEditorScreen', () => {
  const mockGoBack = jest.fn();

  beforeEach(() => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPresetEdit',
      name: 'SymptomPresetEdit',
      params: { presetId },
    } as never);
    jest.mocked(useNavigation).mockReturnValue({
      goBack: mockGoBack,
    } as never);

    jest.mocked(useAppTheme).mockReturnValue({
      colorScheme: 'light',
      colors: lightAppColors,
      themePreference: 'system',
      setThemePreference: jest.fn(() => Promise.resolve()),
      navigationTheme: DefaultTheme,
      statusBarStyle: 'dark',
    });

    jest.mocked(fetchSymptomPresetById).mockResolvedValue({
      ok: true,
      data: presetRow,
    });

    jest.mocked(saveNewPresetSymptom).mockReset();
    jest.mocked(savePresetSymptomOrder).mockReset();
    jest.mocked(fetchPresetSymptoms).mockReset();
  });

  test('adding a symptom calls saveNewPresetSymptom and shows the new line', async () => {
    const newLine = makeLine('line-new', 0, 'Nausea');

    let fetchCount = 0;
    jest.mocked(fetchPresetSymptoms).mockImplementation(async () => {
      fetchCount += 1;
      if (fetchCount === 1) {
        return { ok: true, data: [] };
      }
      return { ok: true, data: [newLine] };
    });

    jest.mocked(saveNewPresetSymptom).mockResolvedValue({
      ok: true,
      data: newLine,
    });

    const screen = render(<SymptomPresetEditorScreen />);

    await screen.findByText('Add a symptom');

    fireEvent.changeText(screen.getByLabelText('New symptom name'), 'Nausea');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Add symptom to preset'));
    });

    await waitFor(() => {
      expect(saveNewPresetSymptom).toHaveBeenCalledWith(
        expect.objectContaining({
          preset_id: presetId,
          symptom_name: 'Nausea',
          response_type: 'yes_no',
          sort_order: 0,
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByDisplayValue('Nausea')).toBeTruthy();
    });
  });

  test('move down on the first line calls savePresetSymptomOrder with reordered ids', async () => {
    const lineA = makeLine('l1', 0, 'Alpha');
    const lineB = makeLine('l2', 1, 'Bravo');

    let linesState: PresetSymptomRow[] = [lineA, lineB];
    jest.mocked(fetchPresetSymptoms).mockImplementation(async () => ({
      ok: true,
      data: linesState,
    }));

    jest
      .mocked(savePresetSymptomOrder)
      .mockImplementation(async (_pid, orderedIds) => {
        if (orderedIds[0] === 'l2' && orderedIds[1] === 'l1') {
          linesState = [lineB, lineA];
        }
        return { ok: true, data: undefined };
      });

    const screen = render(<SymptomPresetEditorScreen />);

    await screen.findByText('Symptoms in order');

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Move symptom 1 down'));
    });

    await waitFor(() => {
      expect(savePresetSymptomOrder).toHaveBeenCalledWith(presetId, [
        'l2',
        'l1',
      ]);
    });
  });
});
