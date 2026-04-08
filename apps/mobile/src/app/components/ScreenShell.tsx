import React from 'react';
import { View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

/**
 * Auth and form screens: safe area, centered layout, card surface.
 * Styled with NativeWind (`className`) for shared Tailwind usage across the app.
 */
export function ScreenShell({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView className="flex-1 justify-center bg-[#f4f7fb] p-4">
      <View className="gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
        {children}
      </View>
    </SafeAreaView>
  );
}
