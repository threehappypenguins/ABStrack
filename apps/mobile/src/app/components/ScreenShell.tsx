import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nw } from '../theme/app-nativewind-classes';

/**
 * Auth and form screens: safe area, centered layout, card surface aligned with web app shell.
 *
 * Semantic colors use static `rgb()` tokens from `tailwind.config.js` with `dark:` pairs
 * (`nw` in `app-nativewind-classes.ts`).
 *
 * @param props - Child content inside the card.
 * @returns Themed shell layout.
 */
export function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView
      className={`flex-1 justify-center p-4 ${nw.screenBg}`}
      edges={['top', 'left', 'right', 'bottom']}
    >
      <View className={`gap-3 rounded-xl p-4 ${nw.card} ${nw.cardShadow}`}>
        {children}
      </View>
    </SafeAreaView>
  );
}
