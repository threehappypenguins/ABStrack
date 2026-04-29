import type { ForwardedRef } from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { CommonActions, DefaultTheme } from '@react-navigation/native';
import { useNavigation, useRoute } from '@react-navigation/native';
import {
  cancelActiveEpisodeById,
  deleteCurrentPassEpisodeSymptomAnswer,
  getEpisodeById,
  listEpisodeMediaForEpisode,
  listEpisodeSymptomsForEpisode,
  listPresetSymptomsForPreset,
  insertEpisodeSymptomAnswer,
  uploadConfirmedEpisodeMedia,
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
import * as ImagePicker from 'expo-image-picker';

const mockRecordAsync = jest.fn();
const mockStopRecording = jest.fn();
const mockToggleRecordingAsync = jest.fn();
const mockTakePictureAsync = jest.fn();
const mockGetSupportedFeatures = jest.fn(() => ({
  toggleRecordingAsyncAvailable: true,
}));
const mockRequestCameraPermission = jest.fn();
const mockRequestMicrophonePermission = jest.fn();

jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useRoute: jest.fn(),
  useNavigation: jest.fn(),
}));

jest.mock('@abstrack/supabase', () => ({
  cancelActiveEpisodeById: jest.fn(),
  getEpisodeById: jest.fn(),
  deleteCurrentPassEpisodeSymptomAnswer: jest.fn(),
  listEpisodeMediaForEpisode: jest.fn(),
  listPresetSymptomsForPreset: jest.fn(),
  listEpisodeSymptomsForEpisode: jest.fn(),
  insertEpisodeSymptomAnswer: jest.fn(),
  uploadConfirmedEpisodeMedia: jest.fn(),
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

jest.mock('expo-image-picker', () => ({
  CameraType: {
    front: 'front',
    back: 'back',
  },
  requestCameraPermissionsAsync: jest.fn(),
  launchCameraAsync: jest.fn(),
}));

jest.mock('expo-camera', () => {
  const React = require('react');
  const { View } = require('react-native');
  const CameraView = React.forwardRef(function MockCameraView(
    props: { onCameraReady?: () => void },
    ref: ForwardedRef<unknown>,
  ) {
    React.useImperativeHandle(ref, () => ({
      recordAsync: mockRecordAsync,
      stopRecording: mockStopRecording,
      toggleRecordingAsync: mockToggleRecordingAsync,
      takePictureAsync: mockTakePictureAsync,
      getSupportedFeatures: mockGetSupportedFeatures,
    }));
    React.useEffect(() => {
      props.onCameraReady?.();
    }, [props]);
    return <View accessibilityLabel="Mock camera view" />;
  });
  return {
    CameraView,
    useCameraPermissions: jest.fn(() => [
      { granted: true },
      mockRequestCameraPermission,
    ]),
    useMicrophonePermissions: jest.fn(() => [
      { granted: true },
      mockRequestMicrophonePermission,
    ]),
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
  const mockReplace = jest.fn();
  const mockAddListener = jest.fn(() => jest.fn());

  const lineA = makeLine('line-a', 0, 'Nausea', 'yes_no');
  const lineB = makeLine('line-b', 1, 'Headache', 'severity_scale');
  const lineSeverityOnly = makeLine('line-sev', 0, 'Pain', 'severity_scale');
  const lineVideoOnly = makeLine('line-video', 0, 'Dizziness', 'video');
  const linePhotoOnly = makeLine('line-photo', 0, 'Facial droop', 'photo');

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
      replace: mockReplace,
      addListener: mockAddListener,
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

    jest.mocked(getEpisodeById).mockResolvedValue({
      ok: true,
      data: {
        id: episodeId,
        user_id: 'test-user-1',
        symptom_preset_id: symptomPresetId,
        health_marker_preset_id: 'hm-preset-1',
        episode_type: 'Other',
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

    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineA, lineB],
    });
    jest.mocked(listEpisodeSymptomsForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
    jest.mocked(listEpisodeMediaForEpisode).mockResolvedValue({
      ok: true,
      data: [],
    });
    jest.mocked(insertEpisodeSymptomAnswer).mockResolvedValue({
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
    jest.mocked(deleteCurrentPassEpisodeSymptomAnswer).mockResolvedValue({
      ok: true,
      data: true,
    });
    jest.mocked(uploadConfirmedEpisodeMedia).mockResolvedValue({
      ok: true,
      data: {
        id: 'em-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        episode_symptom_id: 'es-1',
        storage_object_key: 'test-user-1/episode-1/video-1.webm',
        thumbnail_storage_key: null,
        media_type: 'video',
        duration_seconds: 3,
        upload_completed_at: '2020-01-01T00:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
    jest.mocked(cancelActiveEpisodeById).mockResolvedValue({
      ok: true,
      data: { didCancel: true },
    });
    jest.mocked(ImagePicker.requestCameraPermissionsAsync).mockResolvedValue({
      granted: true,
    } as never);
    jest.mocked(ImagePicker.launchCameraAsync).mockResolvedValue({
      canceled: true,
      assets: [],
    } as never);
    mockRecordAsync.mockResolvedValue({ uri: 'file:///tmp/video.mp4' });
    mockTakePictureAsync.mockResolvedValue({ uri: 'file:///tmp/photo.jpg' });
    mockStopRecording.mockReset();
    mockToggleRecordingAsync.mockReset();
    mockRequestCameraPermission.mockResolvedValue({ granted: true });
    mockRequestMicrophonePermission.mockResolvedValue({ granted: true });
  });

  test('non-free-text answer triggers insertEpisodeSymptomAnswer', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    jest.mocked(insertEpisodeSymptomAnswer).mockClear();

    fireEvent.press(screen.getByText('yes'));

    await waitFor(() => {
      expect(insertEpisodeSymptomAnswer).toHaveBeenCalledTimes(1);
    });

    expect(insertEpisodeSymptomAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        line: lineA,
        answer: { type: 'yes_no', value: true },
      }),
    );
  });

  test('deselecting severity clears server row via delete (no null upsert)', async () => {
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineSeverityOnly],
    });
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Severity 3'));
    await waitFor(() => {
      expect(insertEpisodeSymptomAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ mockClient: true }),
        expect.objectContaining({
          line: lineSeverityOnly,
          answer: { type: 'severity_scale', value: 3 },
        }),
      );
    });

    jest.mocked(insertEpisodeSymptomAnswer).mockClear();
    jest.mocked(deleteCurrentPassEpisodeSymptomAnswer).mockClear();
    fireEvent.press(screen.getByLabelText('Severity 3'));

    await waitFor(() => {
      expect(deleteCurrentPassEpisodeSymptomAnswer).toHaveBeenCalledWith(
        expect.objectContaining({ mockClient: true }),
        expect.objectContaining({
          episodeId,
          presetSymptomId: lineSeverityOnly.id,
          lastPostMarkerStepCompletedAt: null,
        }),
      );
    });
    expect(insertEpisodeSymptomAnswer).not.toHaveBeenCalled();
  });

  test('free_text typing stages changes without server insert until explicit commit', async () => {
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineFreeOnly],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    jest.mocked(insertEpisodeSymptomAnswer).mockClear();

    const input = screen.getByLabelText('Notes notes');
    fireEvent.changeText(input, 'a');
    fireEvent.changeText(input, 'ab');
    expect(insertEpisodeSymptomAnswer).not.toHaveBeenCalled();
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

    jest.mocked(insertEpisodeSymptomAnswer).mockClear();

    jest.useFakeTimers();
    try {
      fireEvent.changeText(screen.getByLabelText('Notes notes'), 'draft');
      expect(insertEpisodeSymptomAnswer).not.toHaveBeenCalled();

      fireEvent.press(screen.getByLabelText('Next symptom'));

      await act(async () => {
        await Promise.resolve();
      });

      await waitFor(() => {
        expect(insertEpisodeSymptomAnswer).toHaveBeenCalledTimes(1);
      });

      expect(insertEpisodeSymptomAnswer).toHaveBeenCalledWith(
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

    fireEvent.press(screen.getByText('yes'));
    fireEvent.press(screen.getByLabelText('Next symptom'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });

    expect(screen.getByText('Headache')).toBeTruthy();
    expect(setSymptomPromptSession).toHaveBeenLastCalledWith(episodeId, {
      activeIndex: 1,
      answers: { [lineA.id]: { type: 'yes_no', value: true } },
    });
  });

  test('only one of Skip and Next is enabled based on answer presence', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    expect(
      screen.getByLabelText('Skip this symptom').props.accessibilityState,
    ).toEqual({
      disabled: false,
    });
    expect(
      screen.getByLabelText('Next symptom').props.accessibilityState,
    ).toEqual({
      disabled: true,
    });

    fireEvent.press(screen.getByText('yes'));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Skip this symptom').props.accessibilityState,
      ).toEqual({
        disabled: true,
      });
    });
    expect(
      screen.getByLabelText('Next symptom').props.accessibilityState,
    ).toEqual({
      disabled: false,
    });
  });

  test('Skip advances step and clears persisted answer for current symptom', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    jest.mocked(deleteCurrentPassEpisodeSymptomAnswer).mockClear();
    fireEvent.press(screen.getByLabelText('Skip this symptom'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });

    expect(deleteCurrentPassEpisodeSymptomAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        episodeId,
        presetSymptomId: lineA.id,
        lastPostMarkerStepCompletedAt: null,
      }),
    );
    expect(setSymptomPromptSession).toHaveBeenCalledWith(episodeId, {
      activeIndex: 0,
      answers: { [lineA.id]: { type: 'yes_no', value: null } },
    });
  });

  test('resume: false restores activeIndex from session after load', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId, resume: false },
    } as never);

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

  test('resume: false uses session index even when server has progress on earlier lines', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId, resume: false },
    } as never);

    jest.mocked(getSymptomPromptSession).mockReturnValue({
      activeIndex: 0,
      answers: {},
    });

    jest.mocked(listEpisodeSymptomsForEpisode).mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'es-a',
          user_id: 'test-user-1',
          episode_id: episodeId,
          preset_symptom_id: lineA.id,
          symptom_name: lineA.symptom_name,
          response_type: 'yes_no',
          response_boolean: true,
          response_severity: null,
          response_text: null,
          sort_order: 0,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
        },
      ],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });
    expect(screen.getByText('Nausea')).toBeTruthy();
  });

  test('resume: true lands on first unanswered line from merged server+session', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId, resume: true },
    } as never);

    jest.mocked(getSymptomPromptSession).mockReturnValue({
      activeIndex: 0,
      answers: {},
    });

    jest.mocked(listEpisodeSymptomsForEpisode).mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'es-a',
          user_id: 'test-user-1',
          episode_id: episodeId,
          preset_symptom_id: lineA.id,
          symptom_name: lineA.symptom_name,
          response_type: 'yes_no',
          response_boolean: true,
          response_severity: null,
          response_text: null,
          sort_order: 0,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
        },
      ],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });
    expect(screen.getByText('Headache')).toBeTruthy();
  });

  test('resume: true on fully answered symptoms lands on last step and Next routes to markers', async () => {
    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId, resume: true },
    } as never);

    jest.mocked(listEpisodeSymptomsForEpisode).mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'es-a',
          user_id: 'test-user-1',
          episode_id: episodeId,
          preset_symptom_id: lineA.id,
          symptom_name: lineA.symptom_name,
          response_type: 'yes_no',
          response_boolean: true,
          response_severity: null,
          response_text: null,
          sort_order: 0,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
        },
        {
          id: 'es-b',
          user_id: 'test-user-1',
          episode_id: episodeId,
          preset_symptom_id: lineB.id,
          symptom_name: lineB.symptom_name,
          response_type: 'severity_scale',
          response_boolean: null,
          response_severity: 3,
          response_text: null,
          sort_order: 1,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
        },
      ],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });
    expect(screen.getByText('Headache')).toBeTruthy();
    fireEvent.press(screen.getByLabelText('Next symptom'));
    expect(mockReplace).toHaveBeenCalledWith('HealthMarkerPrompt', {
      episodeId,
      resume: true,
    });
  });

  test('Skip on free-text flushes immediately after answer is cleared', async () => {
    const lineAfter = makeLine('line-after', 1, 'Headache', 'severity_scale');
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineFreeOnly, lineAfter],
    });
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.changeText(screen.getByLabelText('Notes notes'), 'draft text');
    jest.mocked(deleteCurrentPassEpisodeSymptomAnswer).mockClear();

    const skipButton = screen.getByLabelText('Skip this symptom');
    expect(skipButton.props.accessibilityState).toEqual({ disabled: true });

    fireEvent.changeText(screen.getByLabelText('Notes notes'), '');
    fireEvent.press(screen.getByLabelText('Skip this symptom'));

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
    });

    expect(deleteCurrentPassEpisodeSymptomAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        episodeId,
        presetSymptomId: lineFreeOnly.id,
        lastPostMarkerStepCompletedAt: null,
      }),
    );
  });

  test('video capture stores local answer and inserts symptom row', async () => {
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [lineVideoOnly],
    });
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    expect(
      screen.getByLabelText('Next symptom').props.accessibilityState,
    ).toEqual({
      disabled: true,
    });

    jest.mocked(insertEpisodeSymptomAnswer).mockClear();
    jest.mocked(uploadConfirmedEpisodeMedia).mockClear();
    fireEvent.press(screen.getByLabelText('Record Dizziness video'));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Start Dizziness video recording'),
      ).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Start Dizziness video recording'));

    await waitFor(() => {
      expect(mockRecordAsync).toHaveBeenCalledTimes(1);
    });

    await waitFor(() => {
      expect(screen.getByLabelText('Use Dizziness video')).toBeTruthy();
      expect(
        screen.getByLabelText('Next symptom').props.accessibilityState,
      ).toEqual({
        disabled: true,
      });
    });
    fireEvent.press(screen.getByLabelText('Use Dizziness video'));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Next symptom').props.accessibilityState,
      ).toEqual({
        disabled: false,
      });
    });

    expect(insertEpisodeSymptomAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        line: lineVideoOnly,
        answer: {
          type: 'video',
          value: {
            localUri: 'file:///tmp/video.mp4',
            durationMs: expect.any(Number),
            capturedAt: expect.any(String),
          },
        },
      }),
    );
    await waitFor(() => {
      expect(uploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(1);
    });
    expect(uploadConfirmedEpisodeMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        episodeSymptomId: 'es-1',
        mediaType: 'video',
        body: expect.any(ArrayBuffer),
        contentType: 'video/mp4',
        extension: 'mp4',
        durationSeconds: expect.anything(),
      }),
    );
    await waitFor(() => {
      expect(setSymptomPromptSession).toHaveBeenCalledWith(
        episodeId,
        expect.objectContaining({
          answers: expect.objectContaining({
            [lineVideoOnly.id]: {
              type: 'video',
              value: {
                localUri: 'storage:test-user-1/episode-1/video-1.webm',
                durationMs: 3000,
                capturedAt: '2020-01-01T00:00:00Z',
              },
            },
          }),
        }),
      );
    });
  });

  test('photo capture stores local answer and inserts symptom row', async () => {
    jest.mocked(listPresetSymptomsForPreset).mockResolvedValue({
      ok: true,
      data: [linePhotoOnly],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 1')).toBeTruthy();
    });

    expect(
      screen.getByLabelText('Next symptom').props.accessibilityState,
    ).toEqual({
      disabled: true,
    });

    jest.mocked(insertEpisodeSymptomAnswer).mockClear();
    jest.mocked(uploadConfirmedEpisodeMedia).mockClear();
    jest.mocked(uploadConfirmedEpisodeMedia).mockResolvedValue({
      ok: true,
      data: {
        id: 'em-photo-1',
        user_id: 'test-user-1',
        episode_id: episodeId,
        episode_symptom_id: 'es-1',
        storage_object_key: 'test-user-1/episode-1/photo-xyz.jpg',
        thumbnail_storage_key: null,
        media_type: 'photo',
        duration_seconds: null,
        upload_completed_at: '2020-01-01T00:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
    });
    fireEvent.press(screen.getByLabelText('Take Facial droop photo'));
    await waitFor(() => {
      expect(screen.getByLabelText('Capture Facial droop photo')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Capture Facial droop photo'));
    await waitFor(() => {
      expect(screen.getByLabelText('Use Facial droop photo')).toBeTruthy();
    });
    fireEvent.press(screen.getByLabelText('Use Facial droop photo'));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Next symptom').props.accessibilityState,
      ).toEqual({
        disabled: false,
      });
    });
    expect(mockTakePictureAsync).toHaveBeenCalledWith(
      expect.objectContaining({
        quality: 0.75,
      }),
    );

    expect(insertEpisodeSymptomAnswer).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        line: linePhotoOnly,
        answer: {
          type: 'photo',
          value: {
            localUri: 'file:///tmp/photo.jpg',
            capturedAt: expect.any(String),
          },
        },
      }),
    );
    await waitFor(() => {
      expect(uploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(1);
    });
    expect(uploadConfirmedEpisodeMedia).toHaveBeenCalledWith(
      expect.objectContaining({ mockClient: true }),
      expect.objectContaining({
        userId: 'test-user-1',
        episodeId,
        episodeSymptomId: 'es-1',
        mediaType: 'photo',
        body: expect.any(ArrayBuffer),
        contentType: 'image/jpeg',
        extension: 'jpg',
        durationSeconds: null,
      }),
    );
    await waitFor(() => {
      expect(setSymptomPromptSession).toHaveBeenCalledWith(
        episodeId,
        expect.objectContaining({
          answers: expect.objectContaining({
            [linePhotoOnly.id]: {
              type: 'photo',
              value: {
                localUri: 'storage:test-user-1/episode-1/photo-xyz.jpg',
                capturedAt: '2020-01-01T00:00:00Z',
              },
            },
          }),
        }),
      );
    });
  });

  test('Exit symptom flow asks for confirmation before leaving', async () => {
    const screen = render(<SymptomPromptScreen />);
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    await waitFor(() => {
      expect(screen.getByLabelText('Exit symptom flow')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Exit symptom flow'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Exit symptom flow?',
      'If you exit now, you will return home. This episode stays open, your progress is saved, and you can resume from home when you are ready.',
      expect.any(Array),
    );
    expect(mockGoBack).not.toHaveBeenCalled();
    alertSpy.mockRestore();
  });

  test('Cancel episode asks for confirmation and cancels episode', async () => {
    const screen = render(<SymptomPromptScreen />);
    const alertSpy = jest
      .spyOn(Alert, 'alert')
      .mockImplementation(() => undefined);

    await waitFor(() => {
      expect(screen.getByLabelText('Cancel episode')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Cancel episode'));

    expect(alertSpy).toHaveBeenCalledWith(
      'Cancel this active episode?',
      'Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone.',
      expect.any(Array),
    );

    const [, , actions] = alertSpy.mock.calls[0] as [
      string,
      string,
      Array<{ onPress?: () => void }>,
    ];
    await act(async () => {
      actions[1]?.onPress?.();
      await Promise.resolve();
    });

    await waitFor(() => {
      expect(cancelActiveEpisodeById).toHaveBeenCalledWith(
        expect.objectContaining({ mockClient: true }),
        episodeId,
      );
    });
    expect(clearSymptomPromptSession).toHaveBeenCalledWith(episodeId);
    expect(mockDispatch).toHaveBeenCalledWith(
      CommonActions.reset({
        index: 0,
        routes: [{ name: 'MainTabs' }],
      }),
    );

    alertSpy.mockRestore();
  });

  test('changing symptomPresetId after fully answered resume state shows prompting for new lines', async () => {
    const lineOnly = makeLine(
      'line-only',
      0,
      'Fatigue',
      'yes_no',
      symptomPresetIdB,
    );

    jest.mocked(useRoute).mockReturnValue({
      key: 'SymptomPrompt',
      name: 'SymptomPrompt',
      params: { episodeId, symptomPresetId, resume: true },
    } as never);
    jest.mocked(listEpisodeSymptomsForEpisode).mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'es-a',
          user_id: 'test-user-1',
          episode_id: episodeId,
          preset_symptom_id: lineA.id,
          symptom_name: lineA.symptom_name,
          response_type: 'yes_no',
          response_boolean: true,
          response_severity: null,
          response_text: null,
          sort_order: 0,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
        },
        {
          id: 'es-b',
          user_id: 'test-user-1',
          episode_id: episodeId,
          preset_symptom_id: lineB.id,
          symptom_name: lineB.symptom_name,
          response_type: 'severity_scale',
          response_boolean: null,
          response_severity: 3,
          response_text: null,
          sort_order: 1,
          created_at: '2020-01-01T00:00:00Z',
          updated_at: '2020-01-01T00:00:00Z',
        },
      ],
    });

    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 2 of 2')).toBeTruthy();
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

  test('Next on last symptom transitions to health marker prompt and persists symptom session', async () => {
    const screen = render(<SymptomPromptScreen />);

    await waitFor(() => {
      expect(screen.getByText('Step 1 of 2')).toBeTruthy();
    });

    fireEvent.press(screen.getByText('yes'));
    fireEvent.press(screen.getByLabelText('Next symptom'));

    await waitFor(() => {
      expect(screen.getByLabelText('Next symptom')).toBeTruthy();
    });

    fireEvent.press(screen.getByLabelText('Severity 1'));
    fireEvent.press(screen.getByLabelText('Next symptom'));

    expect(setSymptomPromptSession).toHaveBeenCalledWith(episodeId, {
      activeIndex: 1,
      answers: {
        [lineA.id]: { type: 'yes_no', value: true },
        [lineB.id]: { type: 'severity_scale', value: 1 },
      },
    });
    expect(mockReplace).toHaveBeenCalledWith('HealthMarkerPrompt', {
      episodeId,
      resume: undefined,
    });
  });
});
