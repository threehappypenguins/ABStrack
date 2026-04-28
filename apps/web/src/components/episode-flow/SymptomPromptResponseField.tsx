'use client';

import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import type { PresetSymptomRow, SymptomPromptAnswer } from '@abstrack/types';
import {
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
  createDefaultSymptomPromptAnswer,
} from '@abstrack/types';

const SYMPTOM_PROMPT_VIDEO_MAX_SECONDS = Math.round(
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS / 1000,
);

/** Visible focus ring on keyboard-focused radio buttons (`button[role="radio"]`). */
const radioLabelFocusVisibleClass =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg';

export type SymptomPromptResponseFieldProps = {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer | undefined;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
};

type YesNoValue = boolean | null;
type CapturedPhotoValue = NonNullable<
  Extract<SymptomPromptAnswer, { type: 'photo' }>['value']
>;
type CapturedVideoValue = NonNullable<
  Extract<SymptomPromptAnswer, { type: 'video' }>['value']
>;

function SymptomYesNoRadiogroup({
  line,
  v,
  onChange,
  disabled,
}: {
  line: PresetSymptomRow;
  v: YesNoValue;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  /**
   * When `v` is null (no selection / deselected), keeps the tab stop on the last-focused or
   * last-clicked option so focus does not stay on a button with `tabIndex={-1}`.
   */
  const [rovingIdx, setRovingIdx] = useState(0);
  useLayoutEffect(() => {
    if (v === true) {
      setRovingIdx(0);
    } else if (v === false) {
      setRovingIdx(1);
    } else {
      const ae =
        typeof document !== 'undefined' ? document.activeElement : null;
      const i = itemRefs.current.findIndex((el) => el === ae);
      if (i >= 0) {
        setRovingIdx(i);
      }
    }
  }, [v]);
  const tabStopIndex = v === null ? rovingIdx : v === true ? 0 : 1;

  const getFocusedIdx = (): number => {
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const i = itemRefs.current.findIndex((el) => el === ae);
    return i >= 0 ? i : tabStopIndex;
  };

  const moveTo = (nextIdx: number) => {
    const boolVal = nextIdx === 0;
    onChange({
      type: 'yes_no',
      value: boolVal,
    });
    requestAnimationFrame(() => {
      itemRefs.current[nextIdx]?.focus();
    });
  };

  const onGroupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const len = 2;
    const cur = getFocusedIdx();
    const { key } = e;
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      e.preventDefault();
      moveTo((cur + 1) % len);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      e.preventDefault();
      moveTo((cur - 1 + len) % len);
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      moveTo(0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      moveTo(len - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={`${line.symptom_name} yes or no`}
      className="flex flex-col gap-3"
      onKeyDown={onGroupKeyDown}
    >
      {(['yes', 'no'] as const).map((which, i) => {
        const boolVal = which === 'yes';
        const selected = v === boolVal;
        return (
          <button
            key={which}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={which}
            tabIndex={i === tabStopIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              const next = selected ? null : boolVal;
              onChange({
                type: 'yes_no',
                value: next,
              });
              if (next === null) {
                requestAnimationFrame(() => {
                  itemRefs.current[i]?.focus();
                });
              }
            }}
            className={`flex min-h-[56px] cursor-pointer items-center justify-center rounded-xl border-2 px-4 py-4 text-base font-semibold transition ${radioLabelFocusVisibleClass} ${
              selected
                ? 'border-app-primary bg-app-primary/10 text-app-ink ring-1 ring-app-primary/20'
                : 'border-app-border/90 bg-app-surface text-app-ink hover:border-app-border'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            <span className="capitalize">{which}</span>
          </button>
        );
      })}
    </div>
  );
}

function SymptomSeverityRadiogroup({
  line,
  sev,
  onChange,
  disabled,
}: {
  line: PresetSymptomRow;
  sev: number | null;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
}) {
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const values = [1, 2, 3, 4, 5] as const;
  const len = values.length;
  /** When `sev` is null, preserves roving tab stop after deselect (same idea as yes/no). */
  const [rovingIdx, setRovingIdx] = useState(0);
  useLayoutEffect(() => {
    if (sev !== null) {
      setRovingIdx(sev - 1);
    } else {
      const ae =
        typeof document !== 'undefined' ? document.activeElement : null;
      const i = itemRefs.current.findIndex((el) => el === ae);
      if (i >= 0) {
        setRovingIdx(i);
      }
    }
  }, [sev]);
  const tabStopIndex = sev !== null ? sev - 1 : rovingIdx;

  const getFocusedIdx = (): number => {
    const ae = typeof document !== 'undefined' ? document.activeElement : null;
    const i = itemRefs.current.findIndex((el) => el === ae);
    return i >= 0 ? i : tabStopIndex;
  };

  const moveTo = (index: number) => {
    const n = values[index];
    onChange({
      type: 'severity_scale',
      value: n,
    });
    requestAnimationFrame(() => {
      itemRefs.current[index]?.focus();
    });
  };

  const onGroupKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (disabled) {
      return;
    }
    const cur = getFocusedIdx();
    const { key } = e;
    if (key === 'ArrowDown' || key === 'ArrowRight') {
      e.preventDefault();
      moveTo((cur + 1) % len);
      return;
    }
    if (key === 'ArrowUp' || key === 'ArrowLeft') {
      e.preventDefault();
      moveTo((cur - 1 + len) % len);
      return;
    }
    if (key === 'Home') {
      e.preventDefault();
      moveTo(0);
      return;
    }
    if (key === 'End') {
      e.preventDefault();
      moveTo(len - 1);
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={`${line.symptom_name} severity 1 to 5`}
      className="flex flex-wrap gap-2"
      onKeyDown={onGroupKeyDown}
    >
      {values.map((n, i) => {
        const selected = sev === n;
        return (
          <button
            key={n}
            ref={(el) => {
              itemRefs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={`Severity ${n}`}
            tabIndex={i === tabStopIndex ? 0 : -1}
            disabled={disabled}
            onClick={() => {
              const next = selected ? null : n;
              onChange({
                type: 'severity_scale',
                value: next,
              });
              if (next === null) {
                requestAnimationFrame(() => {
                  itemRefs.current[i]?.focus();
                });
              }
            }}
            className={`flex h-14 min-w-[52px] cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-base font-semibold transition ${radioLabelFocusVisibleClass} ${
              selected
                ? 'border-app-primary bg-app-primary/10 text-app-ink ring-1 ring-app-primary/20'
                : 'border-app-border/90 bg-app-surface text-app-ink hover:border-app-border'
            } ${disabled ? 'cursor-not-allowed opacity-50' : ''}`}
          >
            {n}
          </button>
        );
      })}
    </div>
  );
}

/**
 * In-flow still photo capture using live camera preview before server upload.
 */
function SymptomPhotoCaptureField({
  line,
  answer,
  onChange,
  disabled,
}: {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const isUnmountedRef = useRef(false);
  const previewingCaptureRef = useRef<CapturedPhotoValue | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [starting, setStarting] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [capturing, setCapturing] = useState(false);
  const [previewingCapture, setPreviewingCapture] =
    useState<CapturedPhotoValue | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number>(16 / 9);
  const modalErrorId = `symptom-photo-error-${line.id}`;

  const captured = answer.type === 'photo' ? answer.value : null;
  const previewing = previewingCapture !== null;

  const stopAllTracks = () => {
    const stream = streamRef.current;
    if (!stream) {
      return;
    }
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    if (!isUnmountedRef.current) {
      setCameraReady(false);
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  };

  useLayoutEffect(() => {
    previewingCaptureRef.current = previewingCapture;
  }, [previewingCapture]);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (previewingCaptureRef.current) {
        URL.revokeObjectURL(previewingCaptureRef.current.localUri);
      }
      stopAllTracks();
    };
  }, []);

  useEffect(() => {
    if (!pickerOpen || previewing) {
      stopAllTracks();
      return;
    }
    if (streamRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setError(null);
      setStarting(true);
      try {
        if (typeof navigator?.mediaDevices?.getUserMedia !== 'function') {
          throw new Error('UNSUPPORTED_MEDIA_DEVICES');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: false,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
        }
      } catch (error: unknown) {
        if (!cancelled) {
          const errorName =
            typeof error === 'object' && error !== null && 'name' in error
              ? String((error as { name?: unknown }).name ?? '')
              : '';
          if (
            errorName === 'NotAllowedError' ||
            errorName === 'PermissionDeniedError'
          ) {
            setError(
              'Camera access was denied. Please enable permissions and try again.',
            );
          } else if (
            errorName === 'NotFoundError' ||
            errorName === 'DevicesNotFoundError'
          ) {
            setError('No camera was found. Connect one and try again.');
          } else {
            setError('Camera is not supported in this browser or environment.');
          }
          setPickerOpen(false);
        }
      } finally {
        if (!cancelled) {
          setStarting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pickerOpen, previewing]);

  const discardPreviewCapture = () => {
    if (!previewingCapture) {
      return;
    }
    URL.revokeObjectURL(previewingCapture.localUri);
    setPreviewingCapture(null);
  };

  const takePhotoFromPreview = async () => {
    const video = previewRef.current;
    if (!video || video.videoWidth === 0 || video.videoHeight === 0) {
      setError('Camera is not ready yet. Try again in a moment.');
      return;
    }
    setError(null);
    setCapturing(true);
    try {
      const canvas = document.createElement('canvas');
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        setError('Could not capture this image in your browser.');
        return;
      }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob((b) => resolve(b), 'image/jpeg', 0.88);
      });
      if (!blob || blob.size === 0) {
        setError('Photo capture failed. Please try again.');
        return;
      }
      const localUri = URL.createObjectURL(blob);
      discardPreviewCapture();
      setPreviewingCapture({
        localUri,
        capturedAt: new Date().toISOString(),
      });
      stopAllTracks();
    } finally {
      setCapturing(false);
    }
  };

  return (
    <div className="space-y-3 rounded-xl border border-app-border/90 bg-app-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={disabled}
          aria-label={
            captured
              ? `Take ${line.symptom_name} photo again`
              : `Take ${line.symptom_name} photo`
          }
          className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border-2 px-4 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
            disabled
              ? 'cursor-not-allowed border-app-border bg-app-surface text-app-muted opacity-60'
              : 'border-app-primary bg-app-primary/10 text-app-ink hover:border-app-primary/80'
          }`}
          onClick={() => {
            setPickerOpen(true);
          }}
        >
          {captured ? 'Take photo again' : 'Take photo'}
        </button>
      </div>
      {pickerOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${line.symptom_name} photo camera`}
            aria-describedby={error ? modalErrorId : undefined}
            className="w-full max-w-2xl rounded-2xl border border-app-border bg-app-surface p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between gap-2">
              <h3 className="text-base font-semibold text-app-ink">
                Take a photo
              </h3>
              <button
                type="button"
                aria-label="Close camera"
                aria-disabled={capturing}
                className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-lg border border-app-border px-3 text-sm font-medium text-app-ink"
                disabled={capturing}
                onClick={() => {
                  if (capturing) {
                    return;
                  }
                  discardPreviewCapture();
                  setPickerOpen(false);
                }}
              >
                Close
              </button>
            </div>
            {!previewingCapture ? (
              <>
                <div className="rounded-xl border border-app-border/90 bg-app-bg p-2">
                  <div
                    className="w-full overflow-hidden rounded-lg bg-black"
                    style={{ aspectRatio: previewAspectRatio }}
                  >
                    <video
                      ref={previewRef}
                      aria-label={`${line.symptom_name} live camera preview`}
                      className="h-full w-full bg-black object-contain"
                      autoPlay
                      muted
                      playsInline
                      onLoadedMetadata={(event) => {
                        const v = event.currentTarget;
                        if (v.videoWidth > 0 && v.videoHeight > 0) {
                          setPreviewAspectRatio(v.videoWidth / v.videoHeight);
                          setCameraReady(true);
                        } else {
                          setCameraReady(false);
                        }
                      }}
                      onEmptied={() => {
                        setCameraReady(false);
                      }}
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-center">
                  <button
                    type="button"
                    aria-disabled={starting || !cameraReady || capturing}
                    aria-label={`Capture ${line.symptom_name} photo`}
                    className={`inline-flex min-h-[56px] min-w-[200px] items-center justify-center rounded-full px-6 text-base font-semibold text-white ${
                      starting || !cameraReady || capturing
                        ? 'cursor-not-allowed bg-slate-400 dark:bg-slate-600'
                        : 'bg-app-primary hover:opacity-95'
                    }`}
                    disabled={starting || !cameraReady || capturing}
                    onClick={() => {
                      void takePhotoFromPreview();
                    }}
                  >
                    {starting
                      ? 'Starting camera…'
                      : capturing
                        ? 'Capturing photo…'
                        : 'Capture photo'}
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-app-border/90 bg-app-bg p-2">
                  <div
                    className="w-full overflow-hidden rounded-lg bg-black"
                    style={{ aspectRatio: previewAspectRatio }}
                  >
                    <img
                      src={previewingCapture.localUri}
                      alt={`${line.symptom_name} photo preview`}
                      className="h-full w-full object-contain"
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    aria-label={`Use ${line.symptom_name} photo`}
                    className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl bg-app-primary px-4 text-base font-semibold text-white hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    onClick={() => {
                      onChange({
                        type: 'photo',
                        value: previewingCapture,
                      });
                      setPreviewingCapture(null);
                      setPickerOpen(false);
                    }}
                  >
                    Use photo
                  </button>
                  <button
                    type="button"
                    aria-label={`Take ${line.symptom_name} photo again`}
                    className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    onClick={() => {
                      discardPreviewCapture();
                    }}
                  >
                    Take again
                  </button>
                </div>
              </>
            )}
            {error ? (
              <p
                id={modalErrorId}
                className="mt-3 text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {error}
              </p>
            ) : null}
          </div>
        </div>
      ) : null}
      <p className="text-sm text-app-muted" role="status">
        {captured
          ? 'Photo selected for this step. You can use Take photo again to replace it.'
          : 'Opens your camera so you can take one photo for this symptom. Large buttons are for easier tapping.'}
      </p>
      {!pickerOpen && error ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-app-muted">
        Media is uploaded to private episode storage after you confirm this
        capture.
      </p>
    </div>
  );
}

function SymptomVideoCaptureField({
  line,
  answer,
  onChange,
  disabled,
}: {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
}) {
  const streamRef = useRef<MediaStream | null>(null);
  const previewRef = useRef<HTMLVideoElement | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startMsRef = useRef(0);
  const autoStopTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isUnmountedRef = useRef(false);
  const previewingCaptureRef = useRef<CapturedVideoValue | null>(null);
  const [recording, setRecording] = useState(false);
  const [starting, setStarting] = useState(false);
  const [recorderOpen, setRecorderOpen] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [previewAspectRatio, setPreviewAspectRatio] = useState<number>(16 / 9);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [previewingCapture, setPreviewingCapture] =
    useState<CapturedVideoValue | null>(null);

  const captured = answer.type === 'video' ? answer.value : null;
  const previewing = previewingCapture !== null;

  const clearAutoStop = () => {
    if (autoStopTimerRef.current !== null) {
      clearTimeout(autoStopTimerRef.current);
      autoStopTimerRef.current = null;
    }
  };

  const stopAllTracks = () => {
    const stream = streamRef.current;
    if (!stream) {
      return;
    }
    stream.getTracks().forEach((track) => {
      track.stop();
    });
    streamRef.current = null;
    if (!isUnmountedRef.current) {
      setCameraReady(false);
    }
    if (previewRef.current) {
      previewRef.current.srcObject = null;
    }
  };

  const stopRecording = () => {
    clearAutoStop();
    const recorder = recorderRef.current;
    if (!recorder) {
      if (!isUnmountedRef.current) {
        setRecording(false);
      }
      stopAllTracks();
      return;
    }
    if (recorder.state !== 'inactive') {
      recorder.stop();
    }
  };

  useLayoutEffect(() => {
    previewingCaptureRef.current = previewingCapture;
  }, [previewingCapture]);

  useEffect(() => {
    isUnmountedRef.current = false;
    return () => {
      isUnmountedRef.current = true;
      if (previewingCaptureRef.current) {
        URL.revokeObjectURL(previewingCaptureRef.current.localUri);
      }
      stopRecording();
      stopAllTracks();
      recorderRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!recorderOpen || previewing) {
      stopRecording();
      stopAllTracks();
      setElapsedMs(0);
      return;
    }
    if (streamRef.current) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setError(null);
      setStarting(true);
      try {
        if (typeof navigator?.mediaDevices?.getUserMedia !== 'function') {
          throw new Error('UNSUPPORTED_MEDIA_DEVICES');
        }
        const stream = await navigator.mediaDevices.getUserMedia({
          video: true,
          audio: true,
        });
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        streamRef.current = stream;
        if (previewRef.current) {
          previewRef.current.srcObject = stream;
        }
        setCameraReady(true);
      } catch (error: unknown) {
        if (!cancelled) {
          const errorName =
            typeof error === 'object' && error !== null && 'name' in error
              ? String((error as { name?: unknown }).name ?? '')
              : '';
          if (
            errorName === 'NotAllowedError' ||
            errorName === 'PermissionDeniedError'
          ) {
            setError(
              'Camera or microphone access was denied. Please enable permissions and try again.',
            );
          } else if (
            errorName === 'NotFoundError' ||
            errorName === 'DevicesNotFoundError'
          ) {
            setError(
              'No camera or microphone was found on this device. Connect one and try again.',
            );
          } else {
            setError(
              'Camera and microphone are not supported in this browser or environment.',
            );
          }
          setRecorderOpen(false);
        }
      } finally {
        if (!cancelled) {
          setStarting(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [previewing, recorderOpen]);

  const discardPreviewCapture = () => {
    if (!previewingCapture) {
      return;
    }
    URL.revokeObjectURL(previewingCapture.localUri);
    setPreviewingCapture(null);
  };

  useEffect(() => {
    if (!recording) {
      return;
    }
    const interval = setInterval(() => {
      setElapsedMs(Math.max(0, Date.now() - startMsRef.current));
    }, 200);
    return () => {
      clearInterval(interval);
    };
  }, [recording]);

  const beginRecording = () => {
    const stream = streamRef.current;
    if (!stream) {
      setError('Camera preview is not ready yet. Try again in a moment.');
      return;
    }
    if (typeof MediaRecorder === 'undefined') {
      setError(
        'Video recording is not supported in this browser. Please try a different browser.',
      );
      return;
    }
    setError(null);
    const recorder = (() => {
      try {
        return new MediaRecorder(stream, {
          mimeType: 'video/webm',
        });
      } catch {
        try {
          return new MediaRecorder(stream);
        } catch {
          setError(
            'Video recording is not supported in this browser. Please try a different browser.',
          );
          return null;
        }
      }
    })();
    if (!recorder) {
      return;
    }
    recorderRef.current = recorder;
    chunksRef.current = [];
    startMsRef.current = Date.now();
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunksRef.current.push(event.data);
      }
    };
    recorder.onerror = () => {
      if (isUnmountedRef.current) {
        stopAllTracks();
        return;
      }
      setError('Video recording failed. Please try again.');
      setRecording(false);
      stopAllTracks();
      setRecorderOpen(false);
    };
    recorder.onstop = () => {
      clearAutoStop();
      if (isUnmountedRef.current) {
        stopAllTracks();
        return;
      }
      const durationMs = Math.min(
        SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
        Math.max(0, Date.now() - startMsRef.current),
      );
      const blob = new Blob(chunksRef.current, {
        type: recorder.mimeType || 'video/webm',
      });
      if (blob.size > 0) {
        discardPreviewCapture();
        const localUri = URL.createObjectURL(blob);
        setPreviewingCapture({
          localUri,
          durationMs,
          capturedAt: new Date().toISOString(),
        });
      }
      setRecording(false);
      stopAllTracks();
    };
    try {
      recorder.start();
      setElapsedMs(0);
      autoStopTimerRef.current = setTimeout(() => {
        stopRecording();
      }, SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS);
      setRecording(true);
    } catch {
      recorderRef.current = null;
      setRecording(false);
      clearAutoStop();
      stopAllTracks();
      setRecorderOpen(false);
      setError('Video recording failed to start. Please try again.');
    }
  };

  const elapsedSeconds = Math.floor(elapsedMs / 1000);
  const elapsedDisplay = `${String(Math.floor(elapsedSeconds / 60)).padStart(
    2,
    '0',
  )}:${String(elapsedSeconds % 60).padStart(2, '0')}`;

  return (
    <div className="space-y-3 rounded-xl border border-app-border/90 bg-app-surface p-4">
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          disabled={disabled}
          aria-label={
            captured
              ? `Record ${line.symptom_name} video again`
              : `Record ${line.symptom_name} video`
          }
          className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border-2 px-4 text-base font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
            disabled
              ? 'cursor-not-allowed border-app-border bg-app-surface text-app-muted opacity-60'
              : 'border-app-primary bg-app-primary/10 text-app-ink hover:border-app-primary/80'
          }`}
          onClick={() => {
            setRecorderOpen(true);
          }}
        >
          {captured
            ? `Record again (max ${SYMPTOM_PROMPT_VIDEO_MAX_SECONDS}s)`
            : `Record video (max ${SYMPTOM_PROMPT_VIDEO_MAX_SECONDS}s)`}
        </button>
      </div>
      {recorderOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`${line.symptom_name} video recorder`}
            className="w-full max-w-2xl rounded-2xl border border-app-border bg-app-surface p-4 shadow-xl"
          >
            <div className="mb-3 flex items-center justify-between">
              <h3 className="text-base font-semibold text-app-ink">
                {`Record video (max ${SYMPTOM_PROMPT_VIDEO_MAX_SECONDS}s)`}
              </h3>
              <div
                className={`rounded-md px-2 py-1 text-sm font-semibold tabular-nums ${
                  recording
                    ? 'bg-red-100 text-red-800 dark:bg-red-950/60 dark:text-red-200'
                    : 'bg-app-bg text-app-muted'
                }`}
                aria-label="Elapsed recording time"
              >
                {elapsedDisplay}
              </div>
              <button
                type="button"
                aria-label="Close recorder"
                aria-disabled={recording}
                className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-app-border px-3 text-sm font-medium text-app-ink"
                disabled={recording}
                onClick={() => {
                  if (recording) {
                    return;
                  }
                  discardPreviewCapture();
                  setRecorderOpen(false);
                }}
              >
                Close
              </button>
            </div>
            {!previewingCapture ? (
              <>
                <div className="rounded-xl border border-app-border/90 bg-app-bg p-2">
                  <div
                    className="w-full overflow-hidden rounded-lg bg-black"
                    style={{ aspectRatio: previewAspectRatio }}
                  >
                    <video
                      ref={previewRef}
                      aria-label={`${line.symptom_name} live camera preview`}
                      className="h-full w-full bg-black object-contain"
                      autoPlay
                      muted
                      playsInline
                      onLoadedMetadata={(event) => {
                        const video = event.currentTarget;
                        if (video.videoWidth > 0 && video.videoHeight > 0) {
                          setPreviewAspectRatio(
                            video.videoWidth / video.videoHeight,
                          );
                        }
                      }}
                    />
                  </div>
                </div>
                <div className="mt-4 flex items-center justify-center gap-3">
                  {!recording ? (
                    <button
                      type="button"
                      aria-disabled={starting || !cameraReady}
                      aria-label={`Start ${line.symptom_name} video recording`}
                      className={`inline-flex min-h-[56px] min-w-[180px] items-center justify-center gap-3 rounded-full px-6 text-base font-semibold text-white ${
                        starting || !cameraReady
                          ? 'cursor-not-allowed bg-red-400'
                          : 'bg-red-700 hover:bg-red-800'
                      }`}
                      disabled={starting || !cameraReady}
                      onClick={beginRecording}
                    >
                      <span
                        aria-hidden="true"
                        className="h-4 w-4 rounded-full bg-white"
                      />
                      {starting ? 'Starting camera…' : 'Start recording'}
                    </button>
                  ) : (
                    <button
                      type="button"
                      aria-label={`Stop ${line.symptom_name} video recording`}
                      className="inline-flex min-h-[56px] min-w-[180px] items-center justify-center rounded-full bg-red-700 px-6 text-base font-semibold text-white hover:bg-red-800"
                      onClick={stopRecording}
                    >
                      Stop recording
                    </button>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="rounded-xl border border-app-border/90 bg-app-bg p-2">
                  <div
                    className="w-full overflow-hidden rounded-lg bg-black"
                    style={{ aspectRatio: previewAspectRatio }}
                  >
                    <video
                      aria-label={`${line.symptom_name} captured video preview`}
                      className="h-full w-full bg-black object-contain"
                      src={previewingCapture.localUri}
                      controls
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-col gap-3 sm:flex-row">
                  <button
                    type="button"
                    aria-label={`Use ${line.symptom_name} video`}
                    className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl bg-app-primary px-4 text-base font-semibold text-white hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    onClick={() => {
                      onChange({
                        type: 'video',
                        value: previewingCapture,
                      });
                      setPreviewingCapture(null);
                      setRecorderOpen(false);
                    }}
                  >
                    Use video
                  </button>
                  <button
                    type="button"
                    aria-label={`Record ${line.symptom_name} video again`}
                    className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                    onClick={() => {
                      discardPreviewCapture();
                    }}
                  >
                    Record again
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
      <p className="text-sm text-app-muted" role="status">
        {recording
          ? `Recording in progress. It stops automatically at ${SYMPTOM_PROMPT_VIDEO_MAX_SECONDS} seconds, or you can stop now.`
          : captured
            ? `Video selected. Duration ${
                captured.durationMs !== null
                  ? `${Math.round(captured.durationMs / 1000)}s`
                  : 'unknown'
              }. Use Record again to replace it.`
            : `Use camera capture for up to ${SYMPTOM_PROMPT_VIDEO_MAX_SECONDS} seconds. Stop any time to finish early.`}
      </p>
      {error ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {error}
        </p>
      ) : null}
      <p className="text-xs text-app-muted">
        Media is uploaded to private episode storage after you confirm this
        capture.
      </p>
    </div>
  );
}

/**
 * Renders the capture UI for one preset symptom line.
 *
 * @param props - Line metadata, current answer, change handler, disabled flag.
 * @returns Response-type-specific controls.
 */
export function SymptomPromptResponseField({
  line,
  answer,
  onChange,
  disabled,
}: SymptomPromptResponseFieldProps) {
  const effective =
    answer ?? createDefaultSymptomPromptAnswer(line.response_type);

  switch (line.response_type) {
    case 'yes_no': {
      const v = effective.type === 'yes_no' ? effective.value : null;
      return (
        <SymptomYesNoRadiogroup
          line={line}
          v={v}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    case 'severity_scale': {
      const sev = effective.type === 'severity_scale' ? effective.value : null;
      return (
        <SymptomSeverityRadiogroup
          line={line}
          sev={sev}
          onChange={onChange}
          disabled={disabled}
        />
      );
    }
    case 'free_text': {
      const text = effective.type === 'free_text' ? effective.value : '';
      return (
        <textarea
          id={`symptom-text-${line.id}`}
          aria-label={`${line.symptom_name} notes`}
          disabled={disabled}
          value={text}
          onChange={(e) => {
            onChange({ type: 'free_text', value: e.target.value });
          }}
          placeholder="Type a short note (optional)"
          rows={5}
          className="w-full rounded-xl border border-app-border/90 bg-app-surface p-4 text-base text-app-ink shadow-sm outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-50"
        />
      );
    }
    case 'photo':
      return (
        <SymptomPhotoCaptureField
          line={line}
          answer={effective}
          onChange={onChange}
          disabled={disabled}
        />
      );
    case 'video':
      return (
        <SymptomVideoCaptureField
          line={line}
          answer={effective}
          onChange={onChange}
          disabled={disabled}
        />
      );
    default: {
      const _exhaustive: never = line.response_type;
      return _exhaustive;
    }
  }
}
