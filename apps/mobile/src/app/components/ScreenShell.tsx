import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { nw } from '../theme/app-nativewind-classes';
import { AppGridBackground } from './AppGridBackground';

export type ScreenShellContentAlign = 'center' | 'stretch';

export type ScreenShellProps = {
  children: React.ReactNode;
  /**
   * `center` (default): vertically centers the card for short forms (auth, settings).
   * `stretch`: card fills the safe area from the top — use for scrollable or multi-section flows
   * so headings stay fully inside the card surface.
   */
  contentAlign?: ScreenShellContentAlign;
};

/**
 * Auth and form screens: safe area, card surface aligned with web app shell.
 *
 * Semantic colors use static `rgb()` tokens from `tailwind.config.js` with `dark:` pairs
 * (`nw` in `app-nativewind-classes.ts`).
 *
 * @param props - Child content inside the card.
 * @returns Themed shell layout.
 */
export function ScreenShell({
  children,
  contentAlign = 'center',
}: ScreenShellProps) {
  const stretch = contentAlign === 'stretch';

  return (
    <SafeAreaView className="flex-1" edges={['top', 'left', 'right', 'bottom']}>
      <AppGridBackground>
        <View className={`flex-1 p-4 ${stretch ? '' : 'justify-center'}`}>
          <View
            className={`gap-3 rounded-xl p-4 ${stretch ? 'min-h-0 w-full flex-1' : ''} ${nw.card} ${nw.cardShadow}`}
          >
            {children}
          </View>
        </View>
      </AppGridBackground>
    </SafeAreaView>
  );
}
