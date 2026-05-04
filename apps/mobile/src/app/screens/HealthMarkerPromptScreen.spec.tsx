import * as React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { DefaultTheme } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  cancelActiveEpisodeById,
  completeEpisodePostMarkerStep,
  createFoodDiaryEntry,
  endEpisodeIfStillActive,
  getEpisodeById,
  listFoodDiaryEntriesForEpisode,
  listEpisodeHealthMarkersForEpisode,
  listEpisodeObservationTimeline,
  listPresetHealthMarkersForPreset,
  PresetDataError,
  updateFoodDiaryEntry,
  insertEpisodeHealthMarkerForLine,
} from '@abstrack/supabase';
import type { PresetHealthMarkerRow } from '@abstrack/types';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { useAppTheme } from '../theme/AppThemeContext';
import { lightAppColors } from '../theme/app-colors';
import { HealthMarkerPromptScreen } from './HealthMarkerPromptScreen';

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('@abstrack/supabase', () => {
  const actual =
    jest.requireActual<typeof import('@abstrack/supabase')>(
      '@abstrack/supabase',
    );
  return {
    ...actual,
    cancelActiveEpisodeById: jest.fn(),
    completeEpisodePostMarkerStep: jest.fn(),
    createFoodDiaryEntry: jest.fn(),
    endEpisodeIfStillActive: jest.fn(),
    getEpisodeById: jest.fn(),
    listFoodDiaryEntriesForEpisode: jest.fn(),
    listEpisodeHealthMarkersForEpisode: jest.fn(),
    listPresetHealthMarkersForPreset: jest.fn(),
    listEpisodeObservationTimeline: jest.fn(async () => ({
      ok: true,
      data: [],
    })),
    updateFoodDiaryEntry: jest.fn(),
    insertEpisodeHealthMarkerForLine: jest.fn(),
  };
});

jest.mock('../../lib/powersync/PowerSyncSessionBridge', () => ({
  usePowerSyncBridgeState: jest.fn(() => ({
    syncChromeEnabled: false,
    powerSyncUrlConfigured: false,
    database: null,
    firstSyncCompleted: false,
    localSqliteInitialized: false,
    syncConnecting: false,
    syncError: null,
  })),
  usePowerSyncManualResync: jest.fn(() => ({
    requestManualResync: jest.fn().mockResolvedValue(undefined),
    manualResyncBusy: false,
  })),
  powerSyncOfflineReplicaReadsEnabled: jest.fn(() => false),
  powerSyncReplicaSqliteReady: jest.fn(() => false),
}));

jest.mock('../../lib/supabase-wiring-core', () => {
  const actual = jest.requireActual(
    '../../lib/supabase-wiring-core',
  ) as typeof import('../../lib/supabase-wiring-core');
  return {
    ...actual,
    getMobileSupabaseClient: jest.fn(() => ({
      mockClient: true,
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'test-user-1' } },
        })),
        getSession: jest.fn(async () => ({
          data: { session: { user: { id: 'test-user-1' } } },
        })),
      },
    })),
  };
});

jest.mock('../theme/AppThemeContext', () => ({
  useAppTheme: jest.fn(),
}));

jest.mock('@abstrack/ui/native', () => {
  const actual = jest.requireActual('@abstrack/ui/native');
  return {
    ...actual,
    announce: jest.fn(async () => undefined),
  };
});

const episodeId = 'episode-1';
const markerPresetId = 'hm-preset-1';

function makeLine(
  id: string,
  sortOrder: number,
  markerKind: PresetHealthMarkerRow['marker_kind'],
  customName: string | null = null,
  customUnit: string | null = null,
): PresetHealthMarkerRow {
  return {
    id,
    preset_id: markerPresetId,
    sort_order: sortOrder,
    marker_kind: markerKind,
    custom_name: customName,
    custom_unit: customUnit,
    created_at: '2020-01-01T00:00:00Z',
    updated_at: '2020-01-01T00:00:00Z',
  };
}

describe('HealthMarkerPromptScreen', () => {
  const mockDispatch = jest.fn();
  const mockReplace = jest.fn();

  const lineA = makeLine('hm-a', 0, 'blood_glucose');
  const lineB = makeLine('hm-b', 1, 'heart_rate');
  const lineBp = makeLine('hm-bp', 0, 'blood_pressure');

  beforeEach(() => {
    jest.clearAllMocks();

    jest.mocked(useRoute).mockReturnValue({
      key: 'HealthMarkerPrompt',
      name: 'HealthMarkerPrompt',
      params: { episodeId, resume: false },
    } as never);

    jest.mocked(useNavigation).mockReturnValue({
      dispatch: mockDispatch,
      replace: mockReplace,
      addListener: jest.fn(() => jest.fn()),
    } as never);

    jest.mocked(useAppTheme).mockReturnValue({
      colorScheme: 'light',
      colors: lightAppColors,
      themePreference: 'system',
      setThemePreference: jest.fn(() => Promise.resolve()),
      navigationTheme: DefaultTheme,
      statusBarStyle: 'dark',
    });

    jest.mocked(getEpisodeById).mockResolvedValue({
      ok: true,
      data: {
        id: episodeId,
        user_id: 'test-user-1',
        symptom_preset_id: 'sym-preset-1',
        health_marker_preset_id: markerPresetId,
        episode_type: 'ABS',
        episode_label: null,
        additional_notes: null,
        note: null,
        started_at: '2020-01-01T00:00:00Z',
        ended_at: null,
        post_marker_step_completed_at: null,
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineA, lineB],
    });
    jest.mocked(listEpisodeHealthMarkersForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
    jest.mocked(insertEpisodeHealthMarkerForLine).mockResolvedValue({
      ok: true,
      data: {
        id: 'hm-row-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        preset_health_marker_id: 'hm-a',
        marker_kind: 'blood_glucose',
        custom_name: null,
        custom_name_key: '',
        custom_unit: null,
        custom_unit_key: '',
        value_numeric: 120,
        systolic_numeric: null,
        diastolic_numeric: null,
        recorded_at: '2020-01-01T00:00:00Z',
        notes: null,
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
    jest.mocked(cancelActiveEpisodeById).mockResolvedValue({
      ok: true,
      data: { didCancel: true },
    });
    jest.mocked(completeEpisodePostMarkerStep).mockResolvedValue({
      ok: true,
      data: {
        id: episodeId,
        user_id: 'test-user-1',
        symptom_preset_id: 'sym-preset-1',
        health_marker_preset_id: markerPresetId,
        episode_type: 'Other',
        episode_label: null,
        additional_notes: null,
        note: null,
        started_at: '2020-01-01T00:00:00Z',
        ended_at: null,
        post_marker_step_completed_at: '2020-01-01T01:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T01:00:00Z',
      },
    });
    jest.mocked(endEpisodeIfStillActive).mockResolvedValue({
      ok: true,
      data: { didEnd: true },
    });
    jest.mocked(createFoodDiaryEntry).mockResolvedValue({
      ok: true,
      data: {
        id: 'food-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        meal_tag: 'Other',
        food_note: 'Snack',
        logged_at: '2020-01-01T01:30:00Z',
        created_at: '2020-01-01T01:30:00Z',
        updated_at: '2020-01-01T01:30:00Z',
      },
    });
    jest.mocked(updateFoodDiaryEntry).mockResolvedValue({
      ok: true,
      data: {
        id: 'food-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        meal_tag: 'Snack',
        food_note: 'Updated note',
        logged_at: '2020-01-01T01:30:00Z',
        created_at: '2020-01-01T01:30:00Z',
        updated_at: '2020-01-01T01:31:00Z',
      },
    });
    jest.mocked(listFoodDiaryEntriesForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
  });

  test('loads marker preset lines and shows first step', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    expect(screen.getByText('Glucose')).toBeTruthy();
    expect(listPresetHealthMarkersForPreset).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      markerPresetId,
    );
    expect(getMobileSupabaseClient).toHaveBeenCalled();
  });

  test('hub resume does not bypass flow when post-marker boundary is missing', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'HealthMarkerPrompt',
      name: 'HealthMarkerPrompt',
      params: { episodeId, resume: true, hub: true },
    } as never);

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });
    expect(screen.queryByLabelText('Log another check-in')).toBeNull();
  });

  test('validation blocks Next and does not upsert when numeric value missing', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Next health marker'));

    await waitFor(() => {
      expect(
        screen.getByText('Enter a numeric value to continue.'),
      ).toBeTruthy();
    });
    expect(insertEpisodeHealthMarkerForLine).not.toHaveBeenCalled();
  });

  test('Skip advances to next marker when current line is unanswered', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Skip this marker'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });
    expect(screen.getByText('Heart rate')).toBeTruthy();
  });

  test('Next upserts with expected payload and advances', async () => {
    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Marker value'), '123.4');
    fireEvent.changeText(screen.getByLabelText('Marker notes'), 'before meal');
    fireEvent.press(screen.getByLabelText('Next health marker'));

    await waitFor(() => {
      expect(insertEpisodeHealthMarkerForLine).toHaveBeenCalledTimes(1);
    });
    expect(insertEpisodeHealthMarkerForLine).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        line: lineA,
        valueNumeric: 123.4,
        systolicNumeric: null,
        diastolicNumeric: null,
        notes: 'before meal',
      }),
    );
    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });
    expect(listEpisodeObservationTimeline).toHaveBeenCalledTimes(1);
  });

  test('blood pressure validation blocks when either value missing', async () => {
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineBp],
    });

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Systolic value'), '120');

    const skip = screen.getByLabelText('Skip this marker');
    expect(skip.props.accessibilityState?.disabled).toBe(false);

    fireEvent.press(screen.getByLabelText('Continue to food diary'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Enter both systolic and diastolic blood pressure values to continue.',
        ),
      ).toBeTruthy();
    });
    expect(insertEpisodeHealthMarkerForLine).not.toHaveBeenCalled();
  });

  test('food diary comes before episode details, then save opens episode hub with log another check-in', async () => {
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineA],
    });

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Marker value'), '100');
    fireEvent.press(screen.getByLabelText('Continue to food diary'));

    await waitFor(() => {
      expect(screen.getByText('Food diary')).toBeTruthy();
    });
    expect(
      screen.getByText(
        'Add one or more meals/snacks for this episode, or skip this step.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Skip food diary entry'));

    await waitFor(() => {
      expect(screen.getByText('Episode details')).toBeTruthy();
    });
    expect(
      screen.getByText(
        'After health markers and food diary, choose ABS or Other; other fields are optional.',
      ),
    ).toBeTruthy();

    fireEvent.press(screen.getByLabelText('Other episode type'));
    fireEvent.changeText(
      screen.getByLabelText('Custom episode label'),
      'Evening flare',
    );
    fireEvent.changeText(
      screen.getByLabelText('Additional symptoms or markers'),
      'Extra symptom text',
    );
    fireEvent.changeText(screen.getByLabelText('Episode note'), 'Felt off');

    fireEvent.press(screen.getByLabelText('Save episode details'));

    await waitFor(() => {
      expect(completeEpisodePostMarkerStep).toHaveBeenCalledTimes(1);
    });
    expect(completeEpisodePostMarkerStep).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      episodeId,
      expect.objectContaining({
        episode_type: 'Other',
        episode_label: 'Evening flare',
        additional_notes: 'Extra symptom text',
        note: 'Felt off',
        post_marker_step_completed_at: null,
      }),
    );

    await waitFor(() => {
      expect(screen.getByLabelText('Log another check-in')).toBeTruthy();
    });
    expect(mockReplace).not.toHaveBeenCalledWith(
      'SymptomPrompt',
      expect.anything(),
    );
  });

  test('post-marker save failure shows postFeedback', async () => {
    jest.mocked(listPresetHealthMarkersForPreset).mockResolvedValue({
      ok: true,
      data: [lineA],
    });
    jest.mocked(completeEpisodePostMarkerStep).mockResolvedValue({
      ok: false,
      error: new PresetDataError(
        'not_found',
        'Could not save episode details. This episode may be missing, already ended, or no longer available.',
      ),
    });

    const screen = render(<HealthMarkerPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Marker value'), '5');
    fireEvent.press(screen.getByLabelText('Continue to food diary'));

    await waitFor(() => {
      expect(screen.getByText('Food diary')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Skip food diary entry'));
    await waitFor(() => {
      expect(screen.getByText('Episode details')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Save episode details'));

    await waitFor(() => {
      expect(
        screen.getByText(
          'Could not save episode details. This episode may be missing, already ended, or no longer available.',
        ),
      ).toBeTruthy();
    });
    expect(screen.getByText('Episode details')).toBeTruthy();
  });
});
