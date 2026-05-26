import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

export type HomeDashboardActionCardProps = {
  /** Visible card heading. */
  heading: string;
  /** Supporting copy under the heading. */
  description: string;
  /** Primary button label. */
  ctaLabel: string;
  /** Spoken label for the primary button. */
  ctaAccessibilityLabel: string;
  /** Runs the primary action. */
  onPress: () => void;
};

/**
 * Neutral dashboard card for Home shortcuts such as standalone health markers and food diary.
 *
 * @param props - Card copy and primary action.
 * @returns Rounded surface with a single primary CTA.
 */
export function HomeDashboardActionCard({
  heading,
  description,
  ctaLabel,
  ctaAccessibilityLabel,
  onPress,
}: HomeDashboardActionCardProps) {
  const { colors } = useAppTheme();

  return (
    <View className={`mb-4 gap-3 rounded-xl p-4 ${nw.card} ${nw.cardShadow}`}>
      <View className="gap-1">
        <Text className={`text-lg font-semibold ${nw.textInk}`}>{heading}</Text>
        <Text className={`text-sm leading-5 ${nw.textMuted}`}>
          {description}
        </Text>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={ctaAccessibilityLabel}
        onPress={onPress}
        className={`min-h-[52px] items-center justify-center rounded-xl px-4 ${nw.btnPrimary}`}
        style={{ backgroundColor: colors.primary }}
      >
        <Text
          className={`text-center text-base font-semibold ${nw.textOnPrimary}`}
        >
          {ctaLabel}
        </Text>
      </Pressable>
    </View>
  );
}
