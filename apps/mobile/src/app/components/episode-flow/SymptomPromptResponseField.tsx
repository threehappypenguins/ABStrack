import React, { useEffect, useRef, useState } from 'react';
import {
  type GestureResponderEvent,
  Modal,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
} from 'react-native';
import type { PresetSymptomRow, SymptomPromptAnswer } from '@abstrack/types';
import {
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
  createDefaultSymptomPromptAnswer,
} from '@abstrack/types';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import * as ImagePicker from 'expo-image-picker';
import {
  CameraView,
  useCameraPermissions,
  useMicrophonePermissions,
} from 'expo-camera';
import { Ionicons } from '@expo/vector-icons';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';

export type SymptomPromptResponseFieldProps = {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer | undefined;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
};
const VIDEO_MAX_DURATION_SECONDS = Math.floor(
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS / 1000,
);

/**
 * Renders the capture UI for one preset symptom line (Week 5 skeleton: no media pipeline).
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
  const { colors } = useAppTheme();
  const [videoBusy, setVideoBusy] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoRecording, setVideoRecording] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);
  const [cameraFacing, setCameraFacing] = useState<'front' | 'back'>('front');
  const [cameraZoom, setCameraZoom] = useState(0);
  const [canTogglePause, setCanTogglePause] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoStartMsRef = useRef<number | null>(null);
  const videoPausedStartedAtRef = useRef<number | null>(null);
  const videoPausedTotalMsRef = useRef(0);
  const cameraRef = useRef<CameraView | null>(null);
  const didCancelRecordingRef = useRef(false);
  const pinchStartDistanceRef = useRef<number | null>(null);
  const pinchStartZoomRef = useRef(0);
  const recordingTaskRef = useRef<Promise<{ uri: string } | undefined> | null>(
    null,
  );

  const clampZoom = (value: number) => Math.min(1, Math.max(0, value));
  const pinchDistance = (event: GestureResponderEvent) => {
    if (event.nativeEvent.touches.length < 2) {
      return null;
    }
    const [first, second] = event.nativeEvent.touches;
    const dx = second.pageX - first.pageX;
    const dy = second.pageY - first.pageY;
    return Math.hypot(dx, dy);
  };

  useEffect(() => {
    return () => {
      if (videoTimerRef.current !== null) {
        clearInterval(videoTimerRef.current);
        videoTimerRef.current = null;
      }
    };
  }, []);

  const stopVideoTimer = () => {
    if (videoTimerRef.current !== null) {
      clearInterval(videoTimerRef.current);
      videoTimerRef.current = null;
    }
  };

  const startVideoTimer = () => {
    stopVideoTimer();
    setElapsedSeconds(0);
    videoStartMsRef.current = Date.now();
    videoPausedTotalMsRef.current = 0;
    videoPausedStartedAtRef.current = null;
    videoTimerRef.current = setInterval(() => {
      if (videoStartMsRef.current === null) {
        setElapsedSeconds(0);
        return;
      }
      if (videoPausedStartedAtRef.current !== null) {
        return;
      }
      setElapsedSeconds(
        Math.floor(
          (Date.now() -
            videoStartMsRef.current -
            videoPausedTotalMsRef.current) /
            1000,
        ),
      );
    }, 250);
  };

  const closeVideoModal = () => {
    if (videoRecording) {
      didCancelRecordingRef.current = true;
      void cameraRef.current?.stopRecording();
    }
    setVideoRecording(false);
    setVideoPaused(false);
    stopVideoTimer();
    videoStartMsRef.current = null;
    videoPausedStartedAtRef.current = null;
    videoPausedTotalMsRef.current = 0;
    setCameraReady(false);
    setVideoModalOpen(false);
  };

  const requestStopRecording = () => {
    if (!videoRecording) {
      return;
    }
    didCancelRecordingRef.current = false;
    void cameraRef.current?.stopRecording();
  };
  const effective =
    answer ?? createDefaultSymptomPromptAnswer(line.response_type);

  switch (line.response_type) {
    case 'yes_no': {
      const v = effective.type === 'yes_no' ? effective.value : null;
      return (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`${line.symptom_name} yes or no`}
          className="gap-3"
        >
          {(['yes', 'no'] as const).map((which) => {
            const boolVal = which === 'yes';
            const selected = v === boolVal;
            return (
              <Pressable
                key={which}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  onChange({
                    type: 'yes_no',
                    value: selected ? null : boolVal,
                  });
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className={`items-center justify-center rounded-xl border-2 px-4 py-4 active:opacity-90 ${
                  selected
                    ? 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                    : 'border-app-border bg-app-bg dark:border-app-border-dark dark:bg-app-bg-dark'
                }`}
              >
                <Text
                  className={`text-[17px] font-semibold capitalize ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {which}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case 'severity_scale': {
      const sev = effective.type === 'severity_scale' ? effective.value : null;
      return (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`${line.symptom_name} severity 1 to 5`}
          className="flex-row flex-wrap gap-2"
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const selected = sev === n;
            return (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityLabel={`Severity ${n}`}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  onChange({
                    type: 'severity_scale',
                    value: selected ? null : n,
                  });
                }}
                style={{
                  minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                  minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                }}
                className={`items-center justify-center rounded-xl border-2 px-3 py-3 active:opacity-90 ${
                  selected
                    ? 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                    : 'border-app-border bg-app-bg dark:border-app-border-dark dark:bg-app-bg-dark'
                }`}
              >
                <Text
                  className={`text-[17px] font-semibold ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case 'free_text': {
      const text = effective.type === 'free_text' ? effective.value : '';
      return (
        <TextInput
          editable={!disabled}
          accessibilityLabel={`${line.symptom_name} notes`}
          multiline
          value={text}
          onChangeText={(t) => {
            onChange({ type: 'free_text', value: t });
          }}
          placeholder="Type a short note (optional)"
          placeholderTextColor={colors.inputPlaceholder}
          className={`min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        />
      );
    }
    case 'photo':
      return (
        <View
          accessibilityRole="text"
          className="rounded-xl border border-dashed border-app-border bg-app-bg p-6 dark:border-app-border-dark dark:bg-app-bg-dark"
        >
          <Text
            className={`text-center text-base leading-relaxed ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Photo symptom capture is coming in a later update. For now, use Next
            or Skip to continue this episode flow.
          </Text>
        </View>
      );
    case 'video': {
      const captured = effective.type === 'video' ? effective.value : null;
      const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(
        2,
        '0',
      )}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
      return (
        <View className="gap-3 rounded-xl border border-app-border bg-app-bg p-4 dark:border-app-border-dark dark:bg-app-bg-dark">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              captured
                ? `Record ${line.symptom_name} video again`
                : `Record ${line.symptom_name} video`
            }
            accessibilityHint={`Opens camera video capture with a ${VIDEO_MAX_DURATION_SECONDS} second limit.`}
            accessibilityState={{ disabled: disabled || videoBusy }}
            disabled={disabled || videoBusy}
            onPress={() => {
              void (async () => {
                setVideoBusy(true);
                try {
                  if (Platform.OS === 'android' || Platform.OS === 'ios') {
                    if (!cameraPermission?.granted) {
                      const granted = await requestCameraPermission();
                      if (!granted.granted) {
                        return;
                      }
                    }
                    if (!microphonePermission?.granted) {
                      const granted = await requestMicrophonePermission();
                      if (!granted.granted) {
                        return;
                      }
                    }
                    setElapsedSeconds(0);
                    setVideoPaused(false);
                    setCameraFacing('front');
                    setCameraZoom(0);
                    setCameraReady(false);
                    setVideoModalOpen(true);
                    return;
                  }
                  const permission =
                    await ImagePicker.requestCameraPermissionsAsync();
                  if (!permission.granted) {
                    return;
                  }
                  const result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ['videos'],
                    legacy: true,
                    allowsEditing: false,
                    quality: 0.6,
                    videoMaxDuration: VIDEO_MAX_DURATION_SECONDS,
                  });
                  if (result.canceled || result.assets.length === 0) {
                    return;
                  }
                  const asset = result.assets[0];
                  onChange({
                    type: 'video',
                    value: {
                      localUri: asset.uri,
                      durationMs:
                        typeof asset.duration === 'number'
                          ? Math.round(asset.duration)
                          : null,
                      capturedAt: new Date().toISOString(),
                    },
                  });
                } finally {
                  setVideoBusy(false);
                }
              })();
            }}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className={`items-center justify-center rounded-xl border-2 px-4 py-4 ${
              disabled || videoBusy
                ? 'border-app-border bg-app-bg opacity-60 dark:border-app-border-dark dark:bg-app-bg-dark'
                : 'border-red-600 bg-red-50 active:opacity-90 dark:border-red-500 dark:bg-red-950/40'
            }`}
          >
            <Text className={`text-[17px] font-semibold ${nw.textInk}`}>
              {videoBusy
                ? 'Opening camera…'
                : captured
                  ? `Record again (max ${VIDEO_MAX_DURATION_SECONDS}s)`
                  : `Record video (max ${VIDEO_MAX_DURATION_SECONDS}s)`}
            </Text>
          </Pressable>
          <Text
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            className={`text-sm leading-relaxed ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            {captured
              ? `Video captured. Duration ${
                  captured.durationMs !== null
                    ? `${Math.round(captured.durationMs / 1000)}s`
                    : 'unknown'
                }.`
              : `Stop early in the camera to save a shorter clip. Maximum is ${VIDEO_MAX_DURATION_SECONDS} seconds.`}
          </Text>
          <Text
            className={`text-xs leading-relaxed ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            Temporary local capture only. Upload is not part of this step.
          </Text>
          <Modal
            visible={videoModalOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={closeVideoModal}
          >
            <View className="flex-1 bg-black">
              <View
                className="flex-1"
                onTouchStart={(event) => {
                  const distance = pinchDistance(event);
                  if (distance === null) {
                    pinchStartDistanceRef.current = null;
                    return;
                  }
                  pinchStartDistanceRef.current = distance;
                  pinchStartZoomRef.current = cameraZoom;
                }}
                onTouchMove={(event) => {
                  const startDistance = pinchStartDistanceRef.current;
                  const distance = pinchDistance(event);
                  if (startDistance === null || distance === null) {
                    return;
                  }
                  const delta = (distance - startDistance) / 250;
                  setCameraZoom(clampZoom(pinchStartZoomRef.current + delta));
                }}
                onTouchEnd={() => {
                  pinchStartDistanceRef.current = null;
                }}
                onTouchCancel={() => {
                  pinchStartDistanceRef.current = null;
                }}
              >
                <CameraView
                  ref={cameraRef}
                  facing={cameraFacing}
                  mode="video"
                  mute={false}
                  zoom={cameraZoom}
                  style={{ flex: 1 }}
                  onCameraReady={() => {
                    setCameraReady(true);
                    const supported = cameraRef.current?.getSupportedFeatures();
                    setCanTogglePause(
                      Boolean(supported?.toggleRecordingAsyncAvailable),
                    );
                  }}
                />
              </View>
              <View className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4 pt-12">
                <Text
                  accessibilityRole="text"
                  className="rounded-md bg-black/70 px-3 py-2 text-base font-semibold text-white"
                  maxFontSizeMultiplier={2}
                >
                  {videoRecording ? `REC ${elapsedLabel}` : 'Ready'}
                </Text>
                <View className="flex-row items-center gap-2">
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Switch camera"
                    onPress={() => {
                      setCameraFacing((v) =>
                        v === 'front' ? 'back' : 'front',
                      );
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="items-center justify-center rounded-md bg-black/70 px-3 py-2"
                  >
                    <Ionicons
                      name="camera-reverse-outline"
                      size={22}
                      color="white"
                    />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Close recorder"
                    onPress={closeVideoModal}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="items-center justify-center rounded-md bg-black/70 px-4 py-2"
                  >
                    <Text className="text-base font-semibold text-white">
                      Close
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View className="absolute bottom-12 left-0 right-0 items-center">
                {!videoRecording ? (
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Start ${line.symptom_name} video recording`}
                    accessibilityState={{ disabled: !cameraReady }}
                    disabled={!cameraReady}
                    onPress={() => {
                      void (async () => {
                        if (!cameraRef.current || !cameraReady) {
                          return;
                        }
                        if (recordingTaskRef.current) {
                          return;
                        }
                        didCancelRecordingRef.current = false;
                        setVideoRecording(true);
                        setVideoPaused(false);
                        startVideoTimer();
                        let recordingTask: Promise<{ uri: string } | undefined>;
                        try {
                          recordingTask = cameraRef.current.recordAsync({
                            maxDuration: VIDEO_MAX_DURATION_SECONDS,
                          });
                        } catch {
                          setVideoRecording(false);
                          stopVideoTimer();
                          return;
                        }
                        recordingTaskRef.current = recordingTask;
                        let result: { uri: string } | undefined;
                        try {
                          result = await recordingTask;
                        } catch {
                          result = undefined;
                        } finally {
                          recordingTaskRef.current = null;
                          setVideoRecording(false);
                          stopVideoTimer();
                        }
                        const activePausedMs =
                          videoPausedStartedAtRef.current !== null
                            ? Date.now() - videoPausedStartedAtRef.current
                            : 0;
                        const durationMs =
                          videoStartMsRef.current !== null
                            ? Math.min(
                                SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
                                Math.max(
                                  0,
                                  Date.now() -
                                    videoStartMsRef.current -
                                    (videoPausedTotalMsRef.current +
                                      activePausedMs),
                                ),
                              )
                            : null;
                        videoStartMsRef.current = null;
                        videoPausedStartedAtRef.current = null;
                        videoPausedTotalMsRef.current = 0;
                        if (didCancelRecordingRef.current) {
                          didCancelRecordingRef.current = false;
                          return;
                        }
                        if (!result?.uri) {
                          return;
                        }
                        setVideoModalOpen(false);
                        onChange({
                          type: 'video',
                          value: {
                            localUri: result.uri,
                            durationMs,
                            capturedAt: new Date().toISOString(),
                          },
                        });
                      })();
                    }}
                    style={{
                      minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                      minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                    }}
                    className={`items-center justify-center ${!cameraReady ? 'opacity-50' : ''}`}
                  >
                    <View className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-transparent">
                      <View className="h-12 w-12 rounded-full bg-red-700" />
                    </View>
                  </Pressable>
                ) : (
                  <View className="flex-row items-center gap-6">
                    {canTogglePause ? (
                      <Pressable
                        accessibilityRole="button"
                        accessibilityLabel={
                          videoPaused
                            ? 'Resume video recording'
                            : 'Pause video recording'
                        }
                        onPress={() => {
                          void (async () => {
                            const camera = cameraRef.current;
                            if (!camera || !canTogglePause) {
                              return;
                            }
                            try {
                              await camera.toggleRecordingAsync();
                            } catch {
                              return;
                            }
                            setVideoPaused((v) => {
                              if (!v) {
                                videoPausedStartedAtRef.current = Date.now();
                              } else if (
                                videoPausedStartedAtRef.current !== null
                              ) {
                                videoPausedTotalMsRef.current +=
                                  Date.now() - videoPausedStartedAtRef.current;
                                videoPausedStartedAtRef.current = null;
                              }
                              return !v;
                            });
                          })();
                        }}
                        style={{
                          minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                          minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                        }}
                        className="items-center justify-center rounded-full bg-white/90 p-4"
                      >
                        <Ionicons
                          name={videoPaused ? 'play' : 'pause'}
                          size={24}
                          color="#111827"
                        />
                      </Pressable>
                    ) : null}
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Stop ${line.symptom_name} video recording`}
                      onPress={requestStopRecording}
                      style={{
                        minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                        minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                      }}
                      className="items-center justify-center"
                    >
                      <View className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-transparent">
                        <View className="h-10 w-10 rounded-md bg-red-700" />
                      </View>
                    </Pressable>
                  </View>
                )}
              </View>
            </View>
          </Modal>
        </View>
      );
    }
    default: {
      const _exhaustive: never = line.response_type;
      return _exhaustive;
    }
  }
}
