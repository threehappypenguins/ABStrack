import React, { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  EpisodeRow,
  EpisodeTemplateWithPresetsRow,
} from '@abstrack/types';
import {
  endEpisodeIfStillActive,
  getActiveEpisodeForUser,
} from '@abstrack/supabase';
import { announce } from '@abstrack/ui/native';
import {
  fetchEpisodeTemplates,
  getCurrentUserId,
} from '../../lib/episode-templates/episode-template-service';
import { getMobileSupabaseClient } from '../../lib/supabase-wiring';
import { saveEpisodeWithTemplatePresets } from '../../lib/episodes/episode-start-service';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { ScreenShell } from '../components/ScreenShell';
import type { MainStackParamList } from '../navigation/types';
import { nw } from '../theme/app-nativewind-classes';

/** Token for focus-scoped loads. */
type FocusLoadCancel = { cancelled: boolean };

type EpisodeStartNav = NativeStackNavigationProp<
  MainStackParamList,
  'EpisodeStart'
>;

/**
 * Episode-start flow: if there is exactly one episode template, start the episode immediately
 * (no tap-through). Otherwise pick a template, then create an episode with both preset ids from
 * that template (no separate symptom or health-marker pickers).
 *
 * @returns Template picker and start action for the impaired-use pathway.
 */
export function EpisodeStartScreen() {
  const navigation = useNavigation<EpisodeStartNav>();
  /** Increments on each screen focus; scopes single-template auto-start idempotency to the current focus cycle. */
  const focusCycleIdRef = useRef(0);
  /** Prevents concurrent `saveEpisodeWithTemplatePresets` on the single-template path when `load` runs more than once before success. */
  const singleTemplateAutoInFlightRef = useRef(false);
  /** `focusCycleId` for which single-template auto-start already succeeded (skips duplicate inserts until a new focus cycle). */
  const singleTemplateAutoSucceededCycleIdRef = useRef<number | null>(null);
  /** Current focus session’s cancellation token; set in `useFocusEffect` and passed to every `load()` so blur cancels in-flight work (including Retry). */
  const focusCancelRef = useRef<FocusLoadCancel | null>(null);

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  /** Set when auto-start (single template) fails; user can retry with Start episode. */
  const [episodeStartError, setEpisodeStartError] = useState<string | null>(
    null,
  );
  const [rows, setRows] = useState<EpisodeTemplateWithPresetsRow[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  /** Open episode blocks starting another until resume or explicit end. */
  const [blockingActiveEpisode, setBlockingActiveEpisode] =
    useState<EpisodeRow | null>(null);
  const [resolvingActiveGate, setResolvingActiveGate] = useState(false);

  const load = useCallback(
    async (focusCancel?: FocusLoadCancel, focusCycle?: number) => {
      const cycleId = focusCycle ?? focusCycleIdRef.current;
      const stale = () => focusCancel?.cancelled === true;

      setStatus('loading');
      setErrorMessage(null);
      setEpisodeStartError(null);
      setBlockingActiveEpisode(null);
      const authResult = await getCurrentUserId();
      if (stale()) {
        return;
      }
      if (!authResult.ok) {
        setErrorMessage(authResult.error.message);
        setStatus('error');
        return;
      }
      if (authResult.data === null) {
        setErrorMessage('You need to be signed in to start an episode.');
        setStatus('error');
        return;
      }
      const userId = authResult.data;

      const supabase = getMobileSupabaseClient();
      const activeResult = await getActiveEpisodeForUser(supabase, userId);
      if (stale()) {
        return;
      }
      if (!activeResult.ok) {
        setErrorMessage(activeResult.error.message);
        setStatus('error');
        return;
      }
      if (activeResult.data) {
        setBlockingActiveEpisode(activeResult.data);
        setRows([]);
        setSubmitting(false);
        setStatus('ready');
        return;
      }

      const result = await fetchEpisodeTemplates();
      if (stale()) {
        return;
      }
      if (!result.ok) {
        setErrorMessage(result.error.message);
        setStatus('error');
        return;
      }

      setRows(result.data);

      if (result.data.length === 1) {
        if (singleTemplateAutoSucceededCycleIdRef.current === cycleId) {
          // Stay on `loading` until `navigation.replace` unmounts — `ready` would flash the chooser if `load` re-runs.
          return;
        }
        if (singleTemplateAutoInFlightRef.current) {
          setStatus('loading');
          return;
        }

        const template = result.data[0];
        singleTemplateAutoInFlightRef.current = true;
        setSubmitting(true);
        let didNavigateToSymptomPrompt = false;
        try {
          const saveResult = await saveEpisodeWithTemplatePresets({
            userId,
            symptomPresetId: template.symptom_preset_id,
            healthMarkerPresetId: template.health_marker_preset_id,
          });
          if (stale()) {
            return;
          }
          if (!saveResult.ok) {
            setSelectedId(template.id);
            setEpisodeStartError(saveResult.error.message);
            announce(saveResult.error.message);
            setStatus('ready');
            return;
          }
          singleTemplateAutoSucceededCycleIdRef.current = cycleId;
          announce('Episode started.');
          // Keep `loading` until navigation unmounts — `ready` would flash the template chooser briefly.
          navigation.replace('SymptomPrompt', {
            episodeId: saveResult.data.id,
            symptomPresetId: template.symptom_preset_id,
          });
          didNavigateToSymptomPrompt = true;
        } finally {
          singleTemplateAutoInFlightRef.current = false;
          if (!stale() && !didNavigateToSymptomPrompt) {
            setSubmitting(false);
          }
        }
        return;
      }

      setSubmitting(false);
      setSelectedId((prev) => {
        if (prev && result.data.some((r) => r.id === prev)) {
          return prev;
        }
        return null;
      });
      setStatus('ready');
    },
    [navigation],
  );

  useFocusEffect(
    useCallback(() => {
      focusCycleIdRef.current += 1;
      const cycleId = focusCycleIdRef.current;
      const focusCancel: FocusLoadCancel = { cancelled: false };
      focusCancelRef.current = focusCancel;
      void load(focusCancel, cycleId);
      return () => {
        focusCancel.cancelled = true;
      };
    }, [load]),
  );

  const onSelectTemplate = (id: string) => {
    setSelectedId(id);
    setEpisodeStartError(null);
    announce(`${rows.find((r) => r.id === id)?.name ?? 'Template'} selected.`);
  };

  const onStartEpisode = async () => {
    if (selectedId === null || submitting) {
      return;
    }
    const template = rows.find((r) => r.id === selectedId);
    if (!template) {
      return;
    }
    setEpisodeStartError(null);
    setSubmitting(true);
    let didNavigateToSymptomPrompt = false;
    try {
      const authResult = await getCurrentUserId();
      if (!authResult.ok) {
        setEpisodeStartError(authResult.error.message);
        announce(authResult.error.message);
        return;
      }
      if (authResult.data === null) {
        const message = 'You need to be signed in to start an episode.';
        setEpisodeStartError(message);
        announce(message);
        return;
      }
      const result = await saveEpisodeWithTemplatePresets({
        userId: authResult.data,
        symptomPresetId: template.symptom_preset_id,
        healthMarkerPresetId: template.health_marker_preset_id,
      });
      if (!result.ok) {
        setEpisodeStartError(result.error.message);
        announce(result.error.message);
        return;
      }
      setEpisodeStartError(null);
      announce('Episode started.');
      navigation.replace('SymptomPrompt', {
        episodeId: result.data.id,
        symptomPresetId: template.symptom_preset_id,
      });
      didNavigateToSymptomPrompt = true;
    } finally {
      if (!didNavigateToSymptomPrompt) {
        setSubmitting(false);
      }
    }
  };

  const onResumeActiveEpisode = useCallback(() => {
    const row = blockingActiveEpisode;
    const presetId = row?.symptom_preset_id;
    if (!row || typeof presetId !== 'string' || !presetId) {
      return;
    }
    navigation.replace('SymptomPrompt', {
      episodeId: row.id,
      symptomPresetId: presetId,
      resume: true,
    });
  }, [blockingActiveEpisode, navigation]);

  const onEndActiveEpisodeAndStartNew = useCallback(async () => {
    const row = blockingActiveEpisode;
    if (!row || resolvingActiveGate) {
      return;
    }
    setResolvingActiveGate(true);
    setEpisodeStartError(null);
    try {
      const supabase = getMobileSupabaseClient();
      const end = await endEpisodeIfStillActive(supabase, row.id);
      if (!end.ok) {
        setEpisodeStartError(end.error.message);
        announce(end.error.message);
        return;
      }
      // Reload start flow before any success announcement so UI matches server state; always await
      // `load` (fallback cancel token if focus ref is unset).
      await load(
        focusCancelRef.current ?? { cancelled: false },
        focusCycleIdRef.current,
      );
      if (!end.data.didEnd) {
        return;
      }
      const verify = await getActiveEpisodeForUser(supabase, row.user_id);
      if (!verify.ok) {
        setEpisodeStartError(verify.error.message);
        return;
      }
      if (!verify.data) {
        announce('Previous episode closed. You can start a new one.');
      } else {
        setEpisodeStartError(
          'We could not confirm your previous episode is closed. Try Continue this episode or try again.',
        );
      }
    } finally {
      setResolvingActiveGate(false);
    }
  }, [blockingActiveEpisode, load, resolvingActiveGate]);

  const gatePresetId = blockingActiveEpisode?.symptom_preset_id;
  const canResumeFromGate =
    typeof gatePresetId === 'string' && gatePresetId.length > 0;

  return (
    <ScreenShell contentAlign="stretch">
      <View className="min-h-0 flex-1 gap-4">
        <Text
          testID="episode-start-screen-title"
          accessibilityRole="header"
          className={`text-[22px] font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          {blockingActiveEpisode
            ? 'Episode already in progress'
            : 'Start an episode'}
        </Text>

        {blockingActiveEpisode ? (
          <View className="gap-4">
            <Text
              className={`text-base leading-relaxed ${nw.textInk}`}
              maxFontSizeMultiplier={2}
              accessibilityLiveRegion="polite"
            >
              You already have one episode open that is not finished. Only one
              episode can be open at a time. Choose what to do next.
            </Text>
            {!canResumeFromGate ? (
              <Text
                className={`text-base leading-relaxed ${nw.textMuted}`}
                maxFontSizeMultiplier={2}
              >
                This episode is missing preset data, so it cannot be resumed.
                End this episode to start a new one.
              </Text>
            ) : null}
            {episodeStartError ? (
              <Text
                accessibilityRole="alert"
                className={`text-base leading-relaxed ${nw.textError}`}
                maxFontSizeMultiplier={2}
              >
                {episodeStartError}
              </Text>
            ) : null}
            {canResumeFromGate ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Continue this episode"
                accessibilityHint="Opens your in-progress episode at the next symptom step"
                accessibilityState={{ disabled: resolvingActiveGate }}
                disabled={resolvingActiveGate}
                onPress={onResumeActiveEpisode}
                className="min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 dark:bg-red-600"
              >
                <Text className="text-center text-[18px] font-semibold text-white">
                  Continue this episode
                </Text>
              </Pressable>
            ) : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={
                resolvingActiveGate
                  ? 'Closing episode'
                  : 'End this episode and start a new one'
              }
              accessibilityHint="Closes the open episode so you can start a new one"
              accessibilityState={{ disabled: resolvingActiveGate }}
              disabled={resolvingActiveGate}
              onPress={() => {
                void onEndActiveEpisodeAndStartNew();
              }}
              className={`min-h-[56px] items-center justify-center rounded-xl border-2 border-app-border bg-app-bg px-4 py-4 active:opacity-90 dark:border-app-border-dark dark:bg-app-bg-dark ${
                canResumeFromGate
                  ? ''
                  : 'bg-red-700 dark:bg-red-600 border-transparent'
              }`}
            >
              <Text
                className={`text-center text-[18px] font-semibold ${
                  canResumeFromGate ? nw.textInk : 'text-white'
                }`}
              >
                {resolvingActiveGate
                  ? 'Closing episode…'
                  : 'End this episode and start a new one'}
              </Text>
            </Pressable>
          </View>
        ) : null}

        {!blockingActiveEpisode ? (
          <AsyncScreenContainer
            status={status}
            loadingAccessibilityLabel={
              submitting ? 'Starting episode' : 'Loading episode templates'
            }
            errorTitle="Could not load templates"
            errorMessage={errorMessage ?? undefined}
            onRetry={() => {
              const token = focusCancelRef.current;
              if (token == null) {
                return;
              }
              void load(token, focusCycleIdRef.current);
            }}
          >
            <ScrollView
              testID="episode-start-template-scroll"
              className="flex-1"
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ paddingBottom: 16 }}
            >
              {rows.length === 1 ? (
                <Text
                  className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Your episode uses the template below for symptoms and health
                  markers.
                </Text>
              ) : rows.length > 1 ? (
                <Text
                  className={`mb-4 text-base leading-relaxed ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  Tap one template for this episode. It sets both your symptom
                  list and health markers for this episode.
                </Text>
              ) : null}

              {episodeStartError ? (
                <Text
                  accessibilityRole="alert"
                  className={`mb-4 text-base leading-relaxed ${nw.textError}`}
                  maxFontSizeMultiplier={2}
                >
                  {episodeStartError}
                </Text>
              ) : null}

              {rows.length === 0 ? (
                <View
                  className="rounded-xl bg-app-bg p-4 dark:bg-app-bg-dark"
                  accessibilityRole="text"
                >
                  <Text
                    className={`text-base leading-relaxed ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    You do not have any episode templates yet. Open the
                    Templates tab, create a template, then come back here.
                  </Text>
                </View>
              ) : (
                <View
                  accessibilityRole="radiogroup"
                  accessibilityLabel="Episode templates"
                >
                  {rows.map((row) => {
                    const selected = selectedId === row.id;
                    return (
                      <Pressable
                        key={row.id}
                        testID={`episode-start-template-option-${row.id}`}
                        accessibilityRole="radio"
                        accessibilityState={{ selected, disabled: submitting }}
                        accessibilityLabel={`${row.name}. Symptoms: ${row.symptom_preset.name}. Health markers: ${row.health_marker_preset.name}.`}
                        onPress={() => {
                          if (!submitting) {
                            onSelectTemplate(row.id);
                          }
                        }}
                        className={`mb-3 rounded-2xl border-2 p-4 active:opacity-90 ${
                          selected
                            ? 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                            : 'border-app-border bg-app-bg dark:border-app-border-dark dark:bg-app-bg-dark'
                        }`}
                      >
                        <Text
                          className={`text-[18px] font-semibold ${nw.textInk}`}
                          maxFontSizeMultiplier={2}
                        >
                          {row.name}
                        </Text>
                        <Text
                          className={`mt-2 text-sm leading-relaxed ${nw.textMuted}`}
                          maxFontSizeMultiplier={2}
                        >
                          Symptoms: {row.symptom_preset.name}
                        </Text>
                        <Text
                          className={`mt-1 text-sm leading-relaxed ${nw.textMuted}`}
                          maxFontSizeMultiplier={2}
                        >
                          Markers: {row.health_marker_preset.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}

              {rows.length > 0 ? (
                <Pressable
                  testID="episode-start-submit"
                  accessibilityRole="button"
                  accessibilityLabel="Start episode with selected template"
                  accessibilityState={{
                    disabled: selectedId === null || submitting,
                  }}
                  disabled={selectedId === null || submitting}
                  onPress={() => {
                    void onStartEpisode();
                  }}
                  className={`mt-4 min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 disabled:opacity-50 dark:bg-red-600`}
                >
                  <Text className="text-center text-[18px] font-semibold text-white">
                    {submitting ? 'Starting…' : 'Start episode'}
                  </Text>
                </Pressable>
              ) : null}
            </ScrollView>
          </AsyncScreenContainer>
        ) : null}
      </View>
    </ScreenShell>
  );
}
