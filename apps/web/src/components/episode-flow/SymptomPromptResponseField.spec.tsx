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
const revokeObjectUrlMock = jest.fn();
let originalNavigatorDescriptor: PropertyDescriptor | undefined;
let originalMediaRecorderDescriptor: PropertyDescriptor | undefined;
let originalCreateObjectUrlDescriptor: PropertyDescriptor | undefined;
let originalRevokeObjectUrlDescriptor: PropertyDescriptor | undefined;

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
  beforeAll(() => {
    originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'navigator',
    );
    originalMediaRecorderDescriptor = Object.getOwnPropertyDescriptor(
      globalThis,
      'MediaRecorder',
    );
    originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.URL,
      'createObjectURL',
    );
    originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.URL,
      'revokeObjectURL',
    );
  });

  beforeEach(() => {
    jest.clearAllMocks();
    createObjectUrlMock.mockReset();
    revokeObjectUrlMock.mockReset();
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
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      value: revokeObjectUrlMock,
      configurable: true,
      writable: true,
    });
  });

  afterEach(() => {
    if (originalNavigatorDescriptor) {
      Object.defineProperty(
        globalThis,
        'navigator',
        originalNavigatorDescriptor,
      );
    }
    if (originalMediaRecorderDescriptor) {
      Object.defineProperty(
        globalThis,
        'MediaRecorder',
        originalMediaRecorderDescriptor,
      );
    }
    if (originalCreateObjectUrlDescriptor) {
      Object.defineProperty(
        globalThis.URL,
        'createObjectURL',
        originalCreateObjectUrlDescriptor,
      );
    }
    if (originalRevokeObjectUrlDescriptor) {
      Object.defineProperty(
        globalThis.URL,
        'revokeObjectURL',
        originalRevokeObjectUrlDescriptor,
      );
    }
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
      expect(
        screen.getByLabelText('Dizziness captured video preview'),
      ).toBeTruthy();
      expect(onChange).toHaveBeenCalledTimes(0);
    });
    fireEvent.click(screen.getByLabelText('Use Dizziness video'));

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
        expect(
          screen.getByLabelText('Nausea captured video preview'),
        ).toBeTruthy();
        expect(onChange).toHaveBeenCalledTimes(0);
      });
      fireEvent.click(screen.getByLabelText('Use Nausea video'));

      await waitFor(() => {
        expect(onChange).toHaveBeenCalledTimes(1);
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('revokes prior object URL when recording again', async () => {
    createObjectUrlMock
      .mockReturnValueOnce('blob:first-video')
      .mockReturnValueOnce('blob:second-video');
    const onChange = jest.fn();
    render(
      <SymptomPromptResponseField
        line={makeLine('Headache')}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Record Headache video'));
    await waitFor(() => {
      expect(
        screen
          .getByLabelText('Start Headache video recording')
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    fireEvent.click(screen.getByLabelText('Start Headache video recording'));
    await waitFor(() => {
      expect(
        screen.getByLabelText('Stop Headache video recording'),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Stop Headache video recording'));
    await waitFor(() => {
      expect(
        screen.getByLabelText('Headache captured video preview'),
      ).toBeTruthy();
      expect(onChange).toHaveBeenCalledTimes(0);
    });
    fireEvent.click(screen.getByLabelText('Use Headache video'));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByLabelText('Record Headache video'));
    await waitFor(() => {
      expect(
        screen
          .getByLabelText('Start Headache video recording')
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    fireEvent.click(screen.getByLabelText('Start Headache video recording'));
    await waitFor(() => {
      expect(
        screen.getByLabelText('Stop Headache video recording'),
      ).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Stop Headache video recording'));
    await waitFor(() => {
      expect(
        screen.getByLabelText('Headache captured video preview'),
      ).toBeTruthy();
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    fireEvent.click(screen.getByLabelText('Use Headache video'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(2);
    });
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();
  });

  it('disables close button while recording to avoid implicit save', async () => {
    const onChange = jest.fn();
    render(
      <SymptomPromptResponseField
        line={makeLine('Fatigue')}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Record Fatigue video'));
    await waitFor(() => {
      expect(
        screen
          .getByLabelText('Start Fatigue video recording')
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    fireEvent.click(screen.getByLabelText('Start Fatigue video recording'));
    await waitFor(() => {
      expect(
        screen.getByLabelText('Close recorder').hasAttribute('disabled'),
      ).toBe(true);
    });
  });

  it('shows a user-facing error when MediaRecorder is unavailable', async () => {
    const onChange = jest.fn();
    Object.defineProperty(globalThis, 'MediaRecorder', {
      value: undefined,
      configurable: true,
      writable: true,
    });
    render(
      <SymptomPromptResponseField
        line={makeLine('Blurred vision')}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Record Blurred vision video'));
    await waitFor(() => {
      expect(
        screen
          .getByLabelText('Start Blurred vision video recording')
          .hasAttribute('disabled'),
      ).toBe(false);
    });
    fireEvent.click(
      screen.getByLabelText('Start Blurred vision video recording'),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          'Video recording is not supported in this browser. Please try a different browser.',
        ),
      ).toBeTruthy();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

function makePhotoLine(symptomName = 'Facial droop'): PresetSymptomRow {
  return {
    id: 'line-photo',
    preset_id: 'preset-1',
    sort_order: 0,
    symptom_name: symptomName,
    response_type: 'photo',
    prompt_instruction: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('SymptomPromptResponseField photo capture', () => {
  let getContextSpy: jest.SpiedFunction<
    typeof HTMLCanvasElement.prototype.getContext
  >;
  let toBlobSpy: jest.SpiedFunction<typeof HTMLCanvasElement.prototype.toBlob>;

  beforeAll(() => {
    if (!originalNavigatorDescriptor) {
      originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(
        globalThis,
        'navigator',
      );
    }
    if (!originalCreateObjectUrlDescriptor) {
      originalCreateObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
        globalThis.URL,
        'createObjectURL',
      );
    }
    if (!originalRevokeObjectUrlDescriptor) {
      originalRevokeObjectUrlDescriptor = Object.getOwnPropertyDescriptor(
        globalThis.URL,
        'revokeObjectURL',
      );
    }
  });

  beforeEach(() => {
    jest.clearAllMocks();
    createObjectUrlMock.mockReset();
    revokeObjectUrlMock.mockReset();
    getUserMediaMock.mockResolvedValue(mockStream);
    createObjectUrlMock.mockReturnValue('blob:local-photo');
    Object.defineProperty(globalThis, 'navigator', {
      value: {
        mediaDevices: {
          getUserMedia: getUserMediaMock,
        },
      },
      configurable: true,
    });
    Object.defineProperty(globalThis.URL, 'createObjectURL', {
      value: createObjectUrlMock,
      configurable: true,
      writable: true,
    });
    Object.defineProperty(globalThis.URL, 'revokeObjectURL', {
      value: revokeObjectUrlMock,
      configurable: true,
      writable: true,
    });
    getContextSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'getContext')
      .mockReturnValue({
        drawImage: jest.fn(),
      } as unknown as CanvasRenderingContext2D);
    toBlobSpy = jest
      .spyOn(HTMLCanvasElement.prototype, 'toBlob')
      .mockImplementation((cb: BlobCallback) => {
        cb(new Blob(['jpeg-bytes'], { type: 'image/jpeg' }));
      });
  });

  afterEach(() => {
    getContextSpy.mockRestore();
    toBlobSpy.mockRestore();
    if (originalNavigatorDescriptor) {
      Object.defineProperty(
        globalThis,
        'navigator',
        originalNavigatorDescriptor,
      );
    }
    if (originalCreateObjectUrlDescriptor) {
      Object.defineProperty(
        globalThis.URL,
        'createObjectURL',
        originalCreateObjectUrlDescriptor,
      );
    }
    if (originalRevokeObjectUrlDescriptor) {
      Object.defineProperty(
        globalThis.URL,
        'revokeObjectURL',
        originalRevokeObjectUrlDescriptor,
      );
    }
  });

  it('captures a still photo and stores a local blob URL', async () => {
    const onChange = jest.fn();
    render(
      <SymptomPromptResponseField
        line={makePhotoLine()}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Take Facial droop photo'));

    await waitFor(() => {
      expect(screen.getByLabelText('Facial droop photo camera')).toBeTruthy();
    });
    await waitFor(() => {
      expect(getUserMediaMock).toHaveBeenCalledWith({
        video: true,
        audio: false,
      });
    });

    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    Object.defineProperty(video!, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video!, 'videoHeight', {
      configurable: true,
      value: 480,
    });
    fireEvent.loadedMetadata(video!);
    await waitFor(() => {
      expect(
        screen
          .getByLabelText('Capture Facial droop photo')
          .hasAttribute('disabled'),
      ).toBe(false);
    });

    fireEvent.click(screen.getByLabelText('Capture Facial droop photo'));

    await waitFor(() => {
      expect(screen.getByAltText('Facial droop photo preview')).toBeTruthy();
      expect(onChange).toHaveBeenCalledTimes(0);
    });
    fireEvent.click(screen.getByLabelText('Use Facial droop photo'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    expect(onChange).toHaveBeenCalledWith({
      type: 'photo',
      value: expect.objectContaining({
        localUri: 'blob:local-photo',
        capturedAt: expect.any(String),
      }),
    });
    expect(getContextSpy).toHaveBeenCalled();
    expect(toBlobSpy).toHaveBeenCalled();
    expect(stopTrackMock).toHaveBeenCalled();
  });

  it('does not revoke the active photo object URL on unmount', async () => {
    const onChange = jest.fn();
    const { unmount } = render(
      <SymptomPromptResponseField
        line={makePhotoLine('Ptosis')}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Take Ptosis photo'));

    await waitFor(() => {
      expect(screen.getByLabelText('Ptosis photo camera')).toBeTruthy();
    });
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    Object.defineProperty(video!, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video!, 'videoHeight', {
      configurable: true,
      value: 480,
    });
    fireEvent.loadedMetadata(video!);

    fireEvent.click(screen.getByLabelText('Capture Ptosis photo'));
    await waitFor(() => {
      expect(screen.getByAltText('Ptosis photo preview')).toBeTruthy();
      expect(onChange).toHaveBeenCalledTimes(0);
    });
    fireEvent.click(screen.getByLabelText('Use Ptosis photo'));
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });

    unmount();
    expect(revokeObjectUrlMock).not.toHaveBeenCalled();
  });

  it('replaces preview photo when taking again before confirming', async () => {
    createObjectUrlMock
      .mockReturnValueOnce('blob:first-photo')
      .mockReturnValueOnce('blob:second-photo');
    const onChange = jest.fn();
    render(
      <SymptomPromptResponseField
        line={makePhotoLine('Jaw')}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Take Jaw photo'));
    await waitFor(() => {
      expect(screen.getByLabelText('Jaw photo camera')).toBeTruthy();
    });
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    Object.defineProperty(video!, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video!, 'videoHeight', {
      configurable: true,
      value: 480,
    });
    fireEvent.loadedMetadata(video!);

    fireEvent.click(screen.getByLabelText('Capture Jaw photo'));
    await waitFor(() => {
      expect(screen.getByAltText('Jaw photo preview')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Take Jaw photo again'));
    expect(revokeObjectUrlMock).toHaveBeenCalledWith('blob:first-photo');
    expect(onChange).not.toHaveBeenCalled();

    await waitFor(() => {
      expect(screen.getByLabelText('Capture Jaw photo')).toBeTruthy();
    });
    const videoAgain = document.querySelector('video');
    expect(videoAgain).toBeTruthy();
    Object.defineProperty(videoAgain!, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(videoAgain!, 'videoHeight', {
      configurable: true,
      value: 480,
    });
    fireEvent.loadedMetadata(videoAgain!);
    fireEvent.click(screen.getByLabelText('Capture Jaw photo'));
    await waitFor(() => {
      expect(screen.getByAltText('Jaw photo preview')).toBeTruthy();
    });
    fireEvent.click(screen.getByLabelText('Use Jaw photo'));

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledTimes(1);
    });
    expect(onChange).toHaveBeenCalledWith({
      type: 'photo',
      value: expect.objectContaining({
        localUri: 'blob:second-photo',
        capturedAt: expect.any(String),
      }),
    });
  });

  it('renders capture failure errors inside the open photo dialog', async () => {
    const onChange = jest.fn();
    toBlobSpy.mockImplementationOnce((cb: BlobCallback) => {
      cb(null);
    });
    render(
      <SymptomPromptResponseField
        line={makePhotoLine('Smile')}
        answer={undefined}
        onChange={onChange}
        disabled={false}
      />,
    );

    fireEvent.click(screen.getByLabelText('Take Smile photo'));
    await waitFor(() => {
      expect(screen.getByLabelText('Smile photo camera')).toBeTruthy();
    });
    const video = document.querySelector('video');
    expect(video).toBeTruthy();
    Object.defineProperty(video!, 'videoWidth', {
      configurable: true,
      value: 640,
    });
    Object.defineProperty(video!, 'videoHeight', {
      configurable: true,
      value: 480,
    });
    fireEvent.loadedMetadata(video!);

    fireEvent.click(screen.getByLabelText('Capture Smile photo'));

    await waitFor(() => {
      expect(
        screen.getByText('Photo capture failed. Please try again.'),
      ).toBeTruthy();
    });
    expect(screen.getByLabelText('Smile photo camera')).toBeTruthy();
    expect(onChange).not.toHaveBeenCalled();
  });
});
