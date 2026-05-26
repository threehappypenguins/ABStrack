import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { AppNavigationShell } from '../components/AppNavigationShell';
import { nw } from '../theme/app-nativewind-classes';

export type InsightsScreenProps = {
  /** Optional trailing header action, such as the app menu button. */
  headerAction?: React.ReactNode;
};

/**
 * Placeholder root for the future mobile Insights experience.
 *
 * @param props - Optional authenticated header action.
 * @returns Temporary tab content while mobile insights are being designed.
 */
export function InsightsScreen({ headerAction }: InsightsScreenProps) {
  return (
    <AppNavigationShell title="Insights" headerAction={headerAction}>
      <ScrollView
        className="flex-1"
        contentContainerStyle={{ flexGrow: 1, padding: 16, paddingBottom: 24 }}
      >
        <View className={`gap-3 rounded-xl p-4 ${nw.card} ${nw.cardShadow}`}>
          <Text className={`text-lg font-semibold ${nw.textInk}`}>
            Insights are coming to mobile
          </Text>
          <Text className={`text-base ${nw.textMuted}`}>
            This tab is reserved for charts, trends, and shared summaries. For
            now, use Home to log entries and Manage to review your history.
          </Text>
        </View>
      </ScrollView>
    </AppNavigationShell>
  );
}
