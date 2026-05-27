import React from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { MIN_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';
import { AppGridBackground } from './AppGridBackground';

/**
 * Async UI phase for preset (and similar) screens before data is wired.
 */
export type AsyncScreenStatus = 'loading' | 'error' | 'ready';

export type AsyncScreenContainerProps = {
  /** Current phase; drives which subtree renders. */
  status: AsyncScreenStatus;
  /** When false, callers render inside an existing screen background. */
  withBackground?: boolean;
  /** Announced while loading (spinner). */
  loadingAccessibilityLabel?: string;
  /** Short heading when `status` is `error`. */
  errorTitle?: string;
  /** Detail when `status` is `error`. */
  errorMessage?: string;
  /** Optional retry when `status` is `error` (large touch target). */
  onRetry?: () => void;
  children: React.ReactNode;
};

/**
 * Centered loading and error regions for async screens; passes through `children` when `ready`.
 * Intended for preset scaffolds until Supabase wiring exists.
 *
 * @param props - Status, optional error copy, and main content.
 * @returns Loading spinner, error panel, or children.
 */
export function AsyncScreenContainer({
  status,
  withBackground = true,
  loadingAccessibilityLabel = 'Loading',
  errorTitle = 'Something went wrong',
  errorMessage = 'We could not load this screen. Check your connection and try again.',
  onRetry,
  children,
}: AsyncScreenContainerProps) {
  const { colors } = useAppTheme();
  const wrapContent = (content: React.ReactNode) =>
    withBackground ? <AppGridBackground>{content}</AppGridBackground> : content;

  if (status === 'loading') {
    return wrapContent(
      <View
        className="flex-1 items-center justify-center"
        accessibilityLabel={loadingAccessibilityLabel}
        accessibilityRole="progressbar"
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>,
    );
  }

  if (status === 'error') {
    return wrapContent(
      <View
        className="flex-1 items-center justify-center gap-3 px-6"
        accessibilityRole="alert"
      >
        <Text
          className={`text-center text-lg font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          {errorTitle}
        </Text>
        <Text
          className={`text-center text-base ${nw.textMuted}`}
          maxFontSizeMultiplier={2}
        >
          {errorMessage}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            className={`mt-2 items-center justify-center rounded-[10px] px-5 active:opacity-90 ${nw.btnPrimary}`}
            style={{
              minHeight: MIN_TOUCH_TARGET_DP,
              minWidth: MIN_TOUCH_TARGET_DP * 3,
            }}
          >
            <Text className={`text-[17px] font-semibold ${nw.textOnPrimary}`}>
              Try again
            </Text>
          </Pressable>
        ) : null}
      </View>,
    );
  }

  return wrapContent(<View className="flex-1">{children}</View>);
}
