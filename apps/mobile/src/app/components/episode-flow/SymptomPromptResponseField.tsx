import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  type GestureResponderEvent,
  Image,
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
import { useVideoPlayer, VideoView } from 'expo-video';
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
  /**
   * Resolves `storage:…` refs to a short-lived HTTPS URL for previews (photo/thumbnail or full
   * video).
   */
  resolveEpisodeMediaPreviewUrl?: (
    storageUri: string,
  ) => Promise<string | null>;
  /** Clears persisted photo/video answer and deletes primary + thumbnail objects server-side. */
  onClearUploadedEpisodeMedia?: () => void;
};

function isPersistedEpisodeMediaLocalUri(
  localUri: string | null | undefined,
): boolean {
  return Boolean(localUri?.trim().startsWith('storage:'));
}

/**
 * Chooses the URI passed to preview signing. Prefer thumbnail only when it is a persisted
 * `storage:` ref — stale `file:` / `blob:` thumbnail strings fall back to `localUri`.
 */
function preferredEpisodeMediaPreviewStorageUri(cap: {
  localUri: string;
  thumbnailStorageUri?: string | null;
}): string {
  const thumb = cap.thumbnailStorageUri?.trim();
  if (thumb && thumb.startsWith('storage:')) {
    return thumb;
  }
  return cap.localUri.trim();
}

/** True when `answer` is a photo step with a non-empty capture URI (blob or `storage:`). */
function hasEpisodePhotoMediaAnswer(answer: SymptomPromptAnswer): boolean {
  if (answer.type !== 'photo') {
    return false;
  }
  const v = answer.value;
  return (
    v !== null && typeof v.localUri === 'string' && v.localUri.trim().length > 0
  );
}

/** True when `answer` is a video step with a non-empty capture URI (blob or `storage:`). */
function hasEpisodeVideoMediaAnswer(answer: SymptomPromptAnswer): boolean {
  if (answer.type !== 'video') {
    return false;
  }
  const v = answer.value;
  return (
    v !== null && typeof v.localUri === 'string' && v.localUri.trim().length > 0
  );
}

function PendingVideoPreview({
  uri,
  accessibilityLabel,
}: {
  uri: string;
  accessibilityLabel: string;
}) {
  const player = useVideoPlayer(uri);
  return (
    <VideoView
      player={player}
      accessibilityLabel={accessibilityLabel}
      nativeControls
      contentFit="contain"
      style={{ flex: 1, width: '100%', height: '100%' }}
    />
  );
}

const VIDEO_MAX_DURATION_SECONDS = Math.floor(
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS / 1000,
);

/**
 * Height of the dashed episode-media preview slot (loading + committed). A fixed inner height
 * avoids `aspectRatio` on the video wrapper leaving empty space below `min-h-[280]` on the outer
 * frame (portrait phones: width×9/16 is shorter than 280).
 */
const EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP = 280;

/**
 * Renders the capture UI for one preset symptom line.
 *
 * @param props - Line metadata, current answer, change handler, disabled flag,
 *   optional preview URL resolver and clear handler for persisted episode media.
 * @returns Response-type-specific controls.
 */
export function SymptomPromptResponseField({
  line,
  answer,
  onChange,
  disabled,
  resolveEpisodeMediaPreviewUrl,
  onClearUploadedEpisodeMedia,
}: SymptomPromptResponseFieldProps) {
  const { colors } = useAppTheme();
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoModalOpen, setPhotoModalOpen] = useState(false);
  const [photoCameraReady, setPhotoCameraReady] = useState(false);
  const [photoCapturing, setPhotoCapturing] = useState(false);
  const [pendingPhotoReview, setPendingPhotoReview] = useState<{
    localUri: string;
    capturedAt: string;
  } | null>(null);
  const [videoBusy, setVideoBusy] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const [microphonePermission, requestMicrophonePermission] =
    useMicrophonePermissions();
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [videoRecording, setVideoRecording] = useState(false);
  const [videoPaused, setVideoPaused] = useState(false);
  const [pendingVideoReview, setPendingVideoReview] = useState<{
    localUri: string;
    durationMs: number | null;
    capturedAt: string;
  } | null>(null);
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

  const [committedMediaPreviewUrl, setCommittedMediaPreviewUrl] = useState<
    string | null
  >(null);
  const [committedMediaPreviewError, setCommittedMediaPreviewError] = useState<
    string | null
  >(null);
  /**
   * Incremented when the user retries preview resolution so the signed-URL effect reruns without
   * changing `effective` (e.g. after network or resolver errors).
   */
  const [
    committedMediaPreviewRetryGeneration,
    setCommittedMediaPreviewRetryGeneration,
  ] = useState(0);
  /**
   * True on “Use photo” / “Use video” until parent `answer` includes the capture (covers the gap
   * before React state reaches this component).
   */
  const [confirmPhotoUseTapPending, setConfirmPhotoUseTapPending] =
    useState(false);
  const [confirmVideoUseTapPending, setConfirmVideoUseTapPending] =
    useState(false);

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
      return;
    }
    setVideoRecording(false);
    setVideoPaused(false);
    stopVideoTimer();
    videoStartMsRef.current = null;
    videoPausedStartedAtRef.current = null;
    videoPausedTotalMsRef.current = 0;
    setPendingVideoReview(null);
    setCameraReady(false);
    setVideoModalOpen(false);
  };

  const requestStopRecording = () => {
    if (!videoRecording) {
      return;
    }
    void cameraRef.current?.stopRecording();
  };
  const closePhotoModal = () => {
    if (photoCapturing) {
      return;
    }
    setPhotoCameraReady(false);
    setPhotoModalOpen(false);
  };
  const effective =
    answer ?? createDefaultSymptomPromptAnswer(line.response_type);

  useEffect(() => {
    if (line.response_type !== 'photo' && line.response_type !== 'video') {
      setCommittedMediaPreviewUrl(null);
      setCommittedMediaPreviewError(null);
      return;
    }
    if (effective.type !== 'photo' && effective.type !== 'video') {
      setCommittedMediaPreviewUrl(null);
      setCommittedMediaPreviewError(null);
      return;
    }
    const cap = effective.value;
    if (
      !cap ||
      !resolveEpisodeMediaPreviewUrl ||
      !isPersistedEpisodeMediaLocalUri(cap.localUri)
    ) {
      setCommittedMediaPreviewUrl(null);
      setCommittedMediaPreviewError(null);
      return;
    }
    const uri =
      effective.type === 'photo'
        ? preferredEpisodeMediaPreviewStorageUri(cap)
        : cap.localUri.trim();
    let cancelled = false;
    setCommittedMediaPreviewError(null);
    setCommittedMediaPreviewUrl(null);
    void resolveEpisodeMediaPreviewUrl(uri)
      .then((url) => {
        if (!cancelled) {
          if (url) {
            setCommittedMediaPreviewUrl(url);
          } else {
            setCommittedMediaPreviewError(
              effective.type === 'photo'
                ? 'Could not load preview. Try again.'
                : 'Could not load video. Try again.',
            );
          }
        }
      })
      .catch(() => {
        if (!cancelled) {
          setCommittedMediaPreviewError(
            effective.type === 'photo'
              ? 'Could not load preview. Check your connection and try again.'
              : 'Could not load video. Check your connection and try again.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    effective,
    line.response_type,
    resolveEpisodeMediaPreviewUrl,
    committedMediaPreviewRetryGeneration,
  ]);

  useLayoutEffect(() => {
    if (confirmPhotoUseTapPending && hasEpisodePhotoMediaAnswer(effective)) {
      setConfirmPhotoUseTapPending(false);
    }
  }, [effective, confirmPhotoUseTapPending]);

  useLayoutEffect(() => {
    if (confirmVideoUseTapPending && hasEpisodeVideoMediaAnswer(effective)) {
      setConfirmVideoUseTapPending(false);
    }
  }, [effective, confirmVideoUseTapPending]);

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
    case 'photo': {
      const capturedPhoto = effective.type === 'photo' ? effective.value : null;
      const canRemovePersistedUploadedPhoto =
        Boolean(onClearUploadedEpisodeMedia) &&
        capturedPhoto !== null &&
        isPersistedEpisodeMediaLocalUri(capturedPhoto.localUri);
      const showPhotoPreviewPanel =
        !pendingPhotoReview &&
        (confirmPhotoUseTapPending ||
          (capturedPhoto !== null &&
            typeof capturedPhoto.localUri === 'string' &&
            capturedPhoto.localUri.trim().length > 0));
      return (
        <View className="gap-3 rounded-xl border border-app-border bg-app-bg p-4 dark:border-app-border-dark dark:bg-app-bg-dark">
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={
              capturedPhoto
                ? `Take ${line.symptom_name} photo again`
                : `Take ${line.symptom_name} photo`
            }
            accessibilityHint="Opens your device camera to take one photo for this symptom."
            accessibilityState={{ disabled: disabled || photoBusy }}
            disabled={disabled || photoBusy}
            onPress={() => {
              void (async () => {
                setPhotoBusy(true);
                try {
                  setPendingPhotoReview(null);
                  if (Platform.OS === 'android' || Platform.OS === 'ios') {
                    if (!cameraPermission?.granted) {
                      const granted = await requestCameraPermission();
                      if (!granted.granted) {
                        return;
                      }
                    }
                    setCameraFacing('front');
                    setCameraZoom(0);
                    setPhotoCameraReady(false);
                    setPhotoModalOpen(true);
                    return;
                  }
                  const permission =
                    await ImagePicker.requestCameraPermissionsAsync();
                  if (!permission.granted) {
                    return;
                  }
                  const result = await ImagePicker.launchCameraAsync({
                    mediaTypes: ['images'],
                    cameraType: ImagePicker.CameraType.front,
                    allowsEditing: false,
                    quality: 0.75,
                    legacy: true,
                  });
                  if (result.canceled || result.assets.length === 0) {
                    return;
                  }
                  const asset = result.assets[0];
                  onChange({
                    type: 'photo',
                    value: {
                      localUri: asset.uri,
                      capturedAt: new Date().toISOString(),
                    },
                  });
                } finally {
                  setPhotoBusy(false);
                }
              })();
            }}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
            className={`items-center justify-center rounded-xl border-2 px-4 py-4 ${
              disabled || photoBusy
                ? 'border-app-border bg-app-bg opacity-60 dark:border-app-border-dark dark:bg-app-bg-dark'
                : 'border-app-primary bg-app-primary/15 active:opacity-90 dark:border-app-primary'
            }`}
          >
            <Text
              className={`text-[17px] font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {photoBusy
                ? 'Opening camera…'
                : capturedPhoto
                  ? 'Take photo again'
                  : 'Take photo'}
            </Text>
          </Pressable>
          <Text
            accessibilityRole="text"
            accessibilityLiveRegion="polite"
            className={`text-sm leading-relaxed ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            {pendingPhotoReview
              ? 'Review your photo, then choose Use photo or Take again.'
              : capturedPhoto
                ? 'Photo selected for this step. Continue when you are ready.'
                : 'Use a large button to open the camera, take one photo, then return here.'}
          </Text>
          {pendingPhotoReview ? (
            <View className="gap-3 rounded-xl border border-app-border bg-white p-3 dark:border-app-border-dark dark:bg-app-bg-dark">
              <Image
                source={{ uri: pendingPhotoReview.localUri }}
                accessibilityLabel={`${line.symptom_name} photo preview`}
                accessibilityIgnoresInvertColors
                style={{
                  width: '100%',
                  aspectRatio: 3 / 4,
                  borderRadius: 12,
                }}
                resizeMode="contain"
              />
              <View className="flex-row gap-3">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Use ${line.symptom_name} photo`}
                  onPress={() => {
                    setConfirmPhotoUseTapPending(true);
                    onChange({
                      type: 'photo',
                      value: pendingPhotoReview,
                    });
                    setPendingPhotoReview(null);
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="flex-1 items-center justify-center rounded-xl bg-app-primary px-4 py-3 active:opacity-90"
                >
                  <Text className="text-[17px] font-semibold text-white">
                    Use photo
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Take ${line.symptom_name} photo again`}
                  onPress={() => {
                    setPendingPhotoReview(null);
                    setCameraFacing('front');
                    setCameraZoom(0);
                    setPhotoCameraReady(false);
                    setPhotoModalOpen(true);
                  }}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="flex-1 items-center justify-center rounded-xl border border-app-border px-4 py-3 active:opacity-90 dark:border-app-border-dark"
                >
                  <Text className={`text-[17px] font-semibold ${nw.textInk}`}>
                    Take again
                  </Text>
                </Pressable>
              </View>
            </View>
          ) : null}
          {showPhotoPreviewPanel ? (
            <View
              className="relative overflow-hidden rounded-xl border-2 border-dashed border-app-border bg-black/10 dark:bg-black/30"
              style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
            >
              {!capturedPhoto ||
              !isPersistedEpisodeMediaLocalUri(capturedPhoto.localUri) ? (
                <View
                  accessibilityLabel="Loading preview"
                  className="items-center justify-center px-4 py-8"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <ActivityIndicator />
                  <Text
                    className={`mt-2 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Loading preview…
                  </Text>
                </View>
              ) : !resolveEpisodeMediaPreviewUrl ? (
                <View
                  accessibilityLabel="Loading preview"
                  className="items-center justify-center px-4 py-8"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <ActivityIndicator />
                  <Text
                    className={`mt-2 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Loading preview…
                  </Text>
                </View>
              ) : committedMediaPreviewError ? (
                <View
                  className="gap-3 px-4 py-4"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <Text
                    accessibilityRole="alert"
                    className="text-sm text-red-700 dark:text-red-300"
                    maxFontSizeMultiplier={2}
                  >
                    {committedMediaPreviewError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Retry loading ${line.symptom_name} photo preview`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => {
                      setCommittedMediaPreviewError(null);
                      setCommittedMediaPreviewRetryGeneration((g) => g + 1);
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="max-w-[220px] items-center justify-center self-start rounded-xl border border-app-border px-4 py-3 active:opacity-90 dark:border-app-border-dark"
                  >
                    <Text className={`text-[17px] font-semibold ${nw.textInk}`}>
                      Try again
                    </Text>
                  </Pressable>
                </View>
              ) : !committedMediaPreviewUrl ? (
                <View
                  accessibilityLabel="Loading preview"
                  className="items-center justify-center px-4 py-8"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <ActivityIndicator />
                  <Text
                    className={`mt-2 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Loading preview…
                  </Text>
                </View>
              ) : (
                <View
                  className="overflow-hidden rounded-lg bg-black"
                  style={{
                    width: '100%',
                    height: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP,
                  }}
                >
                  <Image
                    source={{ uri: committedMediaPreviewUrl }}
                    accessibilityLabel={`${line.symptom_name} uploaded photo preview`}
                    accessibilityIgnoresInvertColors
                    style={{
                      width: '100%',
                      height: '100%',
                      borderRadius: 12,
                    }}
                    resizeMode="contain"
                  />
                </View>
              )}
              {canRemovePersistedUploadedPhoto ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove uploaded ${line.symptom_name} photo`}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => {
                    Alert.alert(
                      'Remove uploaded photo?',
                      'This deletes the saved photo and its thumbnail from this episode. You cannot undo this.',
                      [
                        { text: 'Keep photo', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => onClearUploadedEpisodeMedia?.(),
                        },
                      ],
                    );
                  }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: 8,
                    minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                    minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                  }}
                  className="items-center justify-center rounded-full border border-white/30 bg-black/65"
                >
                  <Ionicons name="close" size={26} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Modal
            visible={photoModalOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={closePhotoModal}
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
                  mode="picture"
                  zoom={cameraZoom}
                  style={{ flex: 1 }}
                  onCameraReady={() => {
                    setPhotoCameraReady(true);
                  }}
                />
              </View>
              <View className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4 pt-12">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Switch camera"
                  onPress={() => {
                    setCameraFacing((v) => (v === 'front' ? 'back' : 'front'));
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
                  accessibilityLabel="Close camera"
                  accessibilityState={{ disabled: photoCapturing }}
                  disabled={photoCapturing}
                  onPress={closePhotoModal}
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                  className="items-center justify-center rounded-md bg-black/70 px-4 py-2"
                >
                  <Text className="text-base font-semibold text-white">
                    Close
                  </Text>
                </Pressable>
              </View>
              <View className="absolute bottom-12 left-0 right-0 items-center">
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Capture ${line.symptom_name} photo`}
                  accessibilityState={{
                    disabled: !photoCameraReady || photoCapturing,
                  }}
                  disabled={!photoCameraReady || photoCapturing}
                  onPress={() => {
                    void (async () => {
                      if (
                        !cameraRef.current ||
                        !photoCameraReady ||
                        photoCapturing
                      ) {
                        return;
                      }
                      setPhotoCapturing(true);
                      try {
                        const result = await cameraRef.current.takePictureAsync(
                          {
                            quality: 0.75,
                          },
                        );
                        if (!result?.uri) {
                          return;
                        }
                        setPhotoModalOpen(false);
                        setPhotoCameraReady(false);
                        setPendingPhotoReview({
                          localUri: result.uri,
                          capturedAt: new Date().toISOString(),
                        });
                      } finally {
                        setPhotoCapturing(false);
                      }
                    })();
                  }}
                  style={{
                    minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                    minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                  }}
                  className={`items-center justify-center ${!photoCameraReady || photoCapturing ? 'opacity-50' : ''}`}
                >
                  <View className="h-20 w-20 items-center justify-center rounded-full border-4 border-white bg-transparent">
                    <View className="h-12 w-12 rounded-full bg-white" />
                  </View>
                </Pressable>
              </View>
            </View>
          </Modal>
          <Text
            className={`text-xs leading-relaxed ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            Media uploads to private episode storage after you confirm this
            capture.
          </Text>
        </View>
      );
    }
    case 'video': {
      const captured = effective.type === 'video' ? effective.value : null;
      const canRemovePersistedUploadedVideo =
        Boolean(onClearUploadedEpisodeMedia) &&
        captured !== null &&
        isPersistedEpisodeMediaLocalUri(captured.localUri);
      const elapsedLabel = `${String(Math.floor(elapsedSeconds / 60)).padStart(
        2,
        '0',
      )}:${String(elapsedSeconds % 60).padStart(2, '0')}`;
      const showVideoPreviewPanel =
        !pendingVideoReview &&
        (confirmVideoUseTapPending ||
          (captured !== null &&
            typeof captured.localUri === 'string' &&
            captured.localUri.trim().length > 0));
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
                  setPendingVideoReview(null);
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
                  setPendingVideoReview({
                    localUri: asset.uri,
                    durationMs:
                      typeof asset.duration === 'number'
                        ? Math.round(asset.duration)
                        : null,
                    capturedAt: new Date().toISOString(),
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
            {pendingVideoReview
              ? `Video ready to review. Duration ${
                  pendingVideoReview.durationMs !== null
                    ? `${Math.round(pendingVideoReview.durationMs / 1000)}s`
                    : 'unknown'
                }. Choose Use video or Record again.`
              : captured
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
            Media uploads to private episode storage after you confirm this
            capture.
          </Text>
          {showVideoPreviewPanel ? (
            <View
              className="relative overflow-hidden rounded-xl border-2 border-dashed border-app-border bg-black/10 dark:bg-black/30"
              style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
            >
              {!captured ||
              !isPersistedEpisodeMediaLocalUri(captured.localUri) ? (
                <View
                  accessibilityLabel="Loading video preview"
                  className="items-center justify-center px-4 py-8"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <ActivityIndicator />
                  <Text
                    className={`mt-2 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Loading preview…
                  </Text>
                </View>
              ) : !resolveEpisodeMediaPreviewUrl ? (
                <View
                  accessibilityLabel="Loading video preview"
                  className="items-center justify-center px-4 py-8"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <ActivityIndicator />
                  <Text
                    className={`mt-2 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Loading preview…
                  </Text>
                </View>
              ) : committedMediaPreviewError ? (
                <View
                  className="gap-3 px-4 py-4"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <Text
                    accessibilityRole="alert"
                    className="text-sm text-red-700 dark:text-red-300"
                    maxFontSizeMultiplier={2}
                  >
                    {committedMediaPreviewError}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Retry loading ${line.symptom_name} video preview`}
                    accessibilityState={{ disabled }}
                    disabled={disabled}
                    onPress={() => {
                      setCommittedMediaPreviewError(null);
                      setCommittedMediaPreviewRetryGeneration((g) => g + 1);
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className="max-w-[220px] items-center justify-center self-start rounded-xl border border-app-border px-4 py-3 active:opacity-90 dark:border-app-border-dark"
                  >
                    <Text className={`text-[17px] font-semibold ${nw.textInk}`}>
                      Try again
                    </Text>
                  </Pressable>
                </View>
              ) : !committedMediaPreviewUrl ? (
                <View
                  accessibilityLabel="Loading video preview"
                  className="items-center justify-center px-4 py-8"
                  style={{ minHeight: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP }}
                >
                  <ActivityIndicator />
                  <Text
                    className={`mt-2 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                  >
                    Loading preview…
                  </Text>
                </View>
              ) : (
                <View
                  className="overflow-hidden rounded-lg bg-black"
                  style={{
                    width: '100%',
                    height: EPISODE_MEDIA_PREVIEW_SLOT_HEIGHT_DP,
                  }}
                >
                  <PendingVideoPreview
                    uri={committedMediaPreviewUrl}
                    accessibilityLabel={`${line.symptom_name} uploaded video`}
                  />
                </View>
              )}
              {canRemovePersistedUploadedVideo ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove uploaded ${line.symptom_name} video`}
                  accessibilityState={{ disabled }}
                  disabled={disabled}
                  onPress={() => {
                    Alert.alert(
                      'Remove uploaded video?',
                      'This deletes the saved video and its thumbnail from this episode. You cannot undo this.',
                      [
                        { text: 'Keep video', style: 'cancel' },
                        {
                          text: 'Remove',
                          style: 'destructive',
                          onPress: () => onClearUploadedEpisodeMedia?.(),
                        },
                      ],
                    );
                  }}
                  style={{
                    position: 'absolute',
                    right: 8,
                    top: 8,
                    minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                    minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                  }}
                  className="items-center justify-center rounded-full border border-white/30 bg-black/65"
                >
                  <Ionicons name="close" size={26} color="#ffffff" />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          <Modal
            visible={videoModalOpen}
            animationType="slide"
            presentationStyle="fullScreen"
            onRequestClose={() => {
              if (!videoRecording) {
                closeVideoModal();
              }
            }}
          >
            <View className="flex-1 bg-black">
              {!pendingVideoReview ? (
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
                      const supported =
                        cameraRef.current?.getSupportedFeatures();
                      setCanTogglePause(
                        Boolean(supported?.toggleRecordingAsyncAvailable),
                      );
                    }}
                  />
                </View>
              ) : (
                <View className="flex-1 items-center justify-center px-4">
                  <View className="h-[70%] w-full overflow-hidden rounded-2xl bg-black">
                    <PendingVideoPreview
                      uri={pendingVideoReview.localUri}
                      accessibilityLabel={`${line.symptom_name} captured video preview`}
                    />
                  </View>
                </View>
              )}
              <View className="absolute left-0 right-0 top-0 flex-row items-center justify-between px-4 pt-12">
                <Text
                  accessibilityRole="text"
                  className="rounded-md bg-black/70 px-3 py-2 text-base font-semibold text-white"
                  maxFontSizeMultiplier={2}
                >
                  {pendingVideoReview
                    ? 'Review'
                    : videoRecording
                      ? `REC ${elapsedLabel}`
                      : 'Ready'}
                </Text>
                <View className="flex-row items-center gap-2">
                  {!pendingVideoReview ? (
                    // expo-camera: changing `facing` during `recordAsync` ends the recording (SDK behavior).
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel="Switch camera"
                      accessibilityHint={
                        videoRecording
                          ? 'Stop recording before switching between front and rear camera.'
                          : 'Toggle between front and rear camera.'
                      }
                      accessibilityState={{ disabled: videoRecording }}
                      disabled={videoRecording}
                      onPress={() => {
                        if (videoRecording) {
                          return;
                        }
                        setCameraFacing((v) =>
                          v === 'front' ? 'back' : 'front',
                        );
                      }}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className={`items-center justify-center rounded-md bg-black/70 px-3 py-2 ${videoRecording ? 'opacity-40' : ''}`}
                    >
                      <Ionicons
                        name="camera-reverse-outline"
                        size={22}
                        color="white"
                      />
                    </Pressable>
                  ) : null}
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={
                      pendingVideoReview
                        ? 'Close video preview'
                        : 'Close recorder'
                    }
                    accessibilityHint={
                      videoRecording
                        ? 'Stop recording before closing to avoid losing your clip.'
                        : undefined
                    }
                    accessibilityState={{ disabled: videoRecording }}
                    disabled={videoRecording}
                    onPress={() => {
                      if (videoRecording) {
                        return;
                      }
                      closeVideoModal();
                    }}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    className={`items-center justify-center rounded-md bg-black/70 px-4 py-2 ${videoRecording ? 'opacity-40' : ''}`}
                  >
                    <Text className="text-base font-semibold text-white">
                      Close
                    </Text>
                  </Pressable>
                </View>
              </View>
              <View className="absolute bottom-12 left-0 right-0 items-center">
                {pendingVideoReview ? (
                  <View className="w-full flex-row items-center gap-4 px-6">
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Record ${line.symptom_name} video again`}
                      onPress={() => {
                        setPendingVideoReview(null);
                        setElapsedSeconds(0);
                        setVideoPaused(false);
                        setCameraFacing('front');
                        setCameraZoom(0);
                        setCameraReady(false);
                      }}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className="flex-1 items-center justify-center rounded-xl bg-black/70 px-4 py-3"
                    >
                      <Text className="text-base font-semibold text-white">
                        Record again
                      </Text>
                    </Pressable>
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Use ${line.symptom_name} video`}
                      onPress={() => {
                        setConfirmVideoUseTapPending(true);
                        onChange({
                          type: 'video',
                          value: pendingVideoReview,
                        });
                        setPendingVideoReview(null);
                        setVideoModalOpen(false);
                      }}
                      style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                      className="flex-1 items-center justify-center rounded-xl bg-app-primary px-4 py-3"
                    >
                      <Text className="text-base font-semibold text-white">
                        Use video
                      </Text>
                    </Pressable>
                  </View>
                ) : !videoRecording ? (
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
                        if (!result?.uri) {
                          return;
                        }
                        setPendingVideoReview({
                          localUri: result.uri,
                          durationMs,
                          capturedAt: new Date().toISOString(),
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
