import React from 'react';
import { Text, View } from 'react-native';
import { ScreenShell } from '../components/ScreenShell';
import { nw } from '../theme/app-nativewind-classes';

/**
 * Episode-start flow shell: reached from the home CTA. Template selection and prompts are added in
 * follow-up work.
 *
 * @returns Placeholder content with stack header back navigation.
 */
export function EpisodeStartScreen() {
  return (
    <ScreenShell>
      <Text
        testID="episode-start-screen-title"
        className={`text-[22px] font-semibold ${nw.textInk}`}
        maxFontSizeMultiplier={2}
      >
        Start an episode
      </Text>
      <Text
        className={`mt-3 text-base leading-relaxed ${nw.textMuted}`}
        maxFontSizeMultiplier={2}
      >
        You are in the episode logging flow. Choosing an episode template and
        stepping through prompts will be added here in follow-up work.
      </Text>

      <View
        className="mt-6 rounded-lg bg-app-bg p-4 dark:bg-app-bg-dark"
        accessibilityLiveRegion="polite"
      >
        <Text
          className={`text-base leading-relaxed ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          This screen confirms you reached the episode-start pathway from home.
          Template selection and symptom prompts are not implemented on this
          screen yet.
        </Text>
      </View>
    </ScreenShell>
  );
}
