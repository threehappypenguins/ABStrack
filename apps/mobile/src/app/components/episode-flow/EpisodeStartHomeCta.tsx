import React, { useEffect, useRef } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { announce } from '@abstrack/ui/native';
import { nw } from '../../theme/app-nativewind-classes';

/** Active episode with the symptom preset needed to resume the prompt flow. */
export type ActiveEpisodeHomeSummary = {
  episodeId: string;
  symptomPresetId: string;
  /**
   * When true, resume should open health markers directly (episode is at explicit end step).
   */
  resumeAtHealthMarkers?: boolean;
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
};

/**
 * Prominent home entry point for episode logging: large touch target, high-contrast primary
 * control, and supporting copy for VoiceOver and TalkBack. CTA mode updates use
 * `accessibilityLiveRegion` on Android only and `announce()` elsewhere so assistive output is not
 * duplicated. Shows **Continue this episode** when {@link ActiveEpisodeHomeSummary} is provided.
 *
 * @param props - Props.
 * @returns Episode CTA section for the home screen.
 */
export function EpisodeStartHomeCta({
  onStartEpisode,
  onResumeEpisode,
  activeEpisode,
  activeEpisodeLoading,
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
          accessibilityHint="Opens your in-progress episode at the next symptom step"
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
