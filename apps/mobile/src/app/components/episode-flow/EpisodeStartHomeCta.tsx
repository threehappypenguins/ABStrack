import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import type { EpisodeRow } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { nw } from '../../theme/app-nativewind-classes';

/**
 * Active episode resume summary for the home CTA.
 *
 * - `resumeAtHealthMarkers: true` means the episode is at the explicit end step **and** the row has
 *   `health_marker_preset_id` (required by the health-marker resume screen).
 * - Otherwise, resume enters symptom prompts and requires `symptomPresetId`.
 */
export type ActiveEpisodeHomeSummary =
  | {
      episodeId: string;
      resumeAtHealthMarkers: true;
      symptomPresetId?: string | null;
    }
  | {
      episodeId: string;
      resumeAtHealthMarkers?: false;
      symptomPresetId: string;
    };

export type EpisodeStartHomeCtaProps = {
  /** Invoked when the user starts the episode flow (no active episode). */
  onStartEpisode: () => void;
  /** Invoked when the user resumes an active episode. */
  onResumeEpisode: (episode: ActiveEpisodeHomeSummary) => void;
  /** When set, the primary control resumes this episode instead of starting a new one. */
  activeEpisode: ActiveEpisodeHomeSummary | null;
  /** Whether an active-episode check is still running. */
  activeEpisodeLoading: boolean;
  /**
   * Shown when the local replica query failed (e.g. broken SQLite) so the UI is not identical to
   * “no active episode” while offline fallback or retry is in play. May be set while
   * {@link activeEpisodeLoading} is still true (e.g. network fallback skipped).
   */
  activeEpisodeQueryError?: string | null;
};

/**
 * True when the episode row is far enough along to open the health-marker prompt in resume mode:
 * post–marker step is done **and** a health marker preset is linked (the screen errors if
 * `health_marker_preset_id` is missing).
 *
 * @param row - Subset of {@link EpisodeRow} fields used for routing.
 */
export function episodeRowEligibleForHealthMarkerResume(
  row: Pick<
    EpisodeRow,
    'post_marker_step_completed_at' | 'health_marker_preset_id'
  >,
): boolean {
  return (
    row.post_marker_step_completed_at != null &&
    row.health_marker_preset_id != null &&
    row.health_marker_preset_id !== ''
  );
}

/**
 * Builds the home continue-episode summary from a replicated {@link EpisodeRow} (same rules as
 * {@link HomeScreen} uses when reading the active episode from PowerSync SQLite).
 *
 * @param row - Episode row from SQLite / PowerSync.
 * @returns Resume summary for the CTA, or `null` when there is no resumable path.
 */
export function episodeRowToActiveHomeSummary(
  row: EpisodeRow,
): ActiveEpisodeHomeSummary | null {
  const hasSymptomResumePath = !!row.symptom_preset_id;
  const hasEndStepResumePath = episodeRowEligibleForHealthMarkerResume(row);
  if (!hasSymptomResumePath && !hasEndStepResumePath) {
    return null;
  }
  if (hasEndStepResumePath) {
    return {
      episodeId: row.id,
      resumeAtHealthMarkers: true,
      symptomPresetId: row.symptom_preset_id,
    };
  }
  return {
    episodeId: row.id,
    symptomPresetId: row.symptom_preset_id as string,
    resumeAtHealthMarkers: false,
  };
}

/**
 * Prominent home entry point for episode logging: large touch target, high-contrast primary
 * control, and supporting copy for VoiceOver and TalkBack. CTA mode updates use
 * `accessibilityLiveRegion` on Android only and `announce()` elsewhere so assistive output is not
 * duplicated. Shows **Continue this episode** when {@link ActiveEpisodeHomeSummary} is provided.
 *
 * @param props - Props.
 * @param props.activeEpisodeQueryError - Optional local-replica query failure message (shown even
 *   while loading when the parent keeps the spinner for that state).
 * @returns Episode CTA section for the home screen.
 */
export function EpisodeStartHomeCta({
  onStartEpisode,
  onResumeEpisode,
  activeEpisode,
  activeEpisodeLoading,
  activeEpisodeQueryError = null,
}: EpisodeStartHomeCtaProps) {
  const prevResumeRef = useRef<boolean | null>(null);

  useEffect(() => {
    if (activeEpisodeLoading) {
      return;
    }
    const hasResume = activeEpisode !== null;
    if (prevResumeRef.current === hasResume) {
      return;
    }
    prevResumeRef.current = hasResume;
    // Android: TalkBack announces `accessibilityLiveRegion` on the description Text — skip
    // `announce` to avoid duplicate output. Other platforms: rely on `announce` (iOS VoiceOver;
    // web/other builds do not use the Android live region).
    if (Platform.OS === 'android') {
      return;
    }
    if (hasResume) {
      void announce(
        'You have an episode in progress. Continue this episode is the primary action.',
        { politeness: 'polite' },
      );
    } else {
      void announce(
        'No episode in progress. You can start logging a new episode.',
        { politeness: 'polite' },
      );
    }
  }, [activeEpisode, activeEpisodeLoading]);

  const showResume = !activeEpisodeLoading && activeEpisode !== null;
  /** Not gated on `activeEpisodeLoading`: Home can keep loading true when the replica query fails and the network fallback is skipped. */
  const showQueryError = Boolean(activeEpisodeQueryError);

  return (
    <View
      testID="episode-start-home-cta"
      accessibilityRole="none"
      className={`mb-4 gap-3 rounded-2xl border-2 border-red-600/40 bg-red-50 p-4 dark:border-red-500/45 dark:bg-red-950/50`}
    >
      <Text
        accessibilityRole="header"
        className={`text-lg font-semibold ${nw.textInk}`}
        maxFontSizeMultiplier={2}
      >
        Episode logging
      </Text>
      {showQueryError ? (
        <Text
          accessibilityRole="alert"
          className={`text-base leading-relaxed ${nw.textError}`}
          maxFontSizeMultiplier={2}
        >
          {activeEpisodeQueryError}
        </Text>
      ) : null}
      <Text
        className={`text-base leading-relaxed ${nw.textMuted}`}
        maxFontSizeMultiplier={2}
        accessibilityLiveRegion={
          Platform.OS === 'android' ? 'polite' : undefined
        }
      >
        {activeEpisodeLoading && 'Checking for an episode in progress…'}
        {!activeEpisodeLoading &&
          showResume &&
          'You have an episode in progress. Continue this episode to pick up where you left off in the guided symptom flow.'}
        {!activeEpisodeLoading &&
          !showResume &&
          'Opens the guided flow to record what you are experiencing during this episode.'}
      </Text>
      {activeEpisodeLoading ? (
        <View
          className="min-h-[56px] items-center justify-center rounded-xl border border-app-border bg-app-surface/90 px-4 py-4 dark:border-neutral-700 dark:bg-neutral-900/80"
          accessibilityRole="progressbar"
          accessibilityLabel="Checking for an episode in progress"
        >
          <Text
            className={`text-center text-base font-medium ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            Loading…
          </Text>
        </View>
      ) : showResume && activeEpisode ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Continue this episode"
          accessibilityHint="Opens your in-progress episode at the next step"
          accessibilityState={{ disabled: false }}
          onPress={() => onResumeEpisode(activeEpisode)}
          className="min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 dark:bg-red-600"
        >
          <Text
            className="text-center text-[18px] font-semibold text-white"
            maxFontSizeMultiplier={2}
          >
            Continue this episode
          </Text>
        </Pressable>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="I'm having an episode"
          accessibilityHint="Opens the guided episode logging flow"
          accessibilityState={{ disabled: false }}
          onPress={onStartEpisode}
          className="min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 py-4 active:opacity-90 dark:bg-red-600"
        >
          <Text
            className="text-center text-[18px] font-semibold text-white"
            maxFontSizeMultiplier={2}
          >
            I'm having an episode
          </Text>
        </Pressable>
      )}
    </View>
  );
}
