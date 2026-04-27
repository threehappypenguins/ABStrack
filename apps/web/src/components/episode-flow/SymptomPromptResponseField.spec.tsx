import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import type { PresetSymptomRow, SymptomPromptAnswer } from '@abstrack/types';
import { SymptomPromptResponseField } from './SymptomPromptResponseField';

const getUserMediaMock = jest.fn();
const createObjectUrlMock = jest.fn();

const stopTrackMock = jest.fn();
const mockStream = {
  getTracks: () => [{ stop: stopTrackMock }],
} as unknown as MediaStream;

class MockMediaRecorder {
  public state: RecordingState = 'inactive';
  public mimeType = 'video/webm';
  public ondataavailable: ((event: BlobEvent) => void) | null = null;
  public onstop: (() => void) | null = null;
  public onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? 'video/webm';
  }

  start() {
    this.state = 'recording';
  }

  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({
      data: new Blob(['video-bytes'], { type: this.mimeType }),
    } as BlobEvent);
    this.onstop?.();
  }
}

function makeLine(symptomName = 'Dizziness'): PresetSymptomRow {
  return {
    id: 'line-video',
    preset_id: 'preset-1',
    sort_order: 0,
    symptom_name: symptomName,
    response_type: 'video',
    prompt_instruction: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('SymptomPromptResponseField video capture', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserMediaMock.mockResolvedValue(mockStream);
    createObjectUrlMock.mockReturnValue('blob:local-video');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: getUserMediaMock,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: MockMediaRecorder,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      value: createObjectUrlMock,
      configurable: true,
      writable: true,
    });
  });

  it('records and saves local video when stopped early', async () => {
    const onChange = jest.fn();
    render(
      <SymptomPromptResponseField
        line={makeLine()}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Record Dizziness video'));

    await waitFor(() => {
      expect(screen.getByLabelText('Dizziness video recorder')).toBeTruthy();
    });
    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledTimes(1);
    });
    await waitFor(() => {
      expect(
        screen.getByLabelText('Start Dizziness video recording'),
      ).toBeTruthy();
      expect(
        screen
          .getByLabelText('Start Dizziness video recording')
          .hasAttribute('disabled'),
      ).toBe(false);
    });

    fireEvent.click(screen.getByLabelText('Start Dizziness video recording'));

    await waitFor(() => {
      expect(
        screen.getByLabelText('Stop Dizziness video recording'),
      ).toBeTruthy();
    });

    fireEvent.click(screen.getByLabelText('Stop Dizziness video recording'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    expect(onChange).toHaveBeenCalledWith({
      type: 'video',
      value: expect.objectContaining({
        localUri: 'blob:local-video',
        durationMs: expect.any(Number),
        capturedAt: expect.any(String),
      }),
    });
    expect(getUserMediaMock).toHaveBeenCalledWith({
      video: true,
      audio: true,
    });
    expect(stopTrackMock).toHaveBeenCalled();
  });

  it('auto-stops recording at 15 seconds', async () => {
    jest.useFakeTimers();
    try {
      const onChange = jest.fn();
      render(
        <SymptomPromptResponseField
          line={makeLine('Nausea')}
          answer={{ type: 'video', value: null } satisfies SymptomPromptAnswer}
          onChange={onChange}
          disabled={false}
        />,
      );

      fireEvent.click(screen.getByLabelText('Record Nausea video'));

      await waitFor(() => {
        expect(getUserMediaMock).toHaveBeenCalledTimes(1);
      });
      await waitFor(() => {
        expect(
          screen.getByLabelText('Start Nausea video recording'),
        ).toBeTruthy();
        expect(
          screen
            .getByLabelText('Start Nausea video recording')
            .hasAttribute('disabled'),
        ).toBe(false);
      });

      fireEvent.click(screen.getByLabelText('Start Nausea video recording'));

      await waitFor(() => {
        expect(
          screen.getByLabelText('Stop Nausea video recording'),
        ).toBeTruthy();
      });

      await act(async () => {
        jest.advanceTimersByTime(15000);
      });

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledTimes(1);
      });
    } finally {
      jest.useRealTimers();
    }
  });
});
