import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { nw } from '../../theme/app-nativewind-classes';

export type EpisodeStartHomeCtaProps = {
  /** Invoked when the user starts the episode flow. */
  onStartEpisode: () => void;
};

/**
 * Prominent home entry point for episode logging: large touch target, high-contrast control, and
 * supporting copy for VoiceOver and TalkBack.
 *
 * @param props - Props.
 * @returns Episode CTA section for the home screen.
 */
export function EpisodeStartHomeCta({
  onStartEpisode,
}: EpisodeStartHomeCtaProps) {
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
      >
        Opens the guided flow to record what you are experiencing during this
        episode.
      </Text>
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
          I&apos;m having an episode
        </Text>
      </Pressable>
    </View>
  );
}
