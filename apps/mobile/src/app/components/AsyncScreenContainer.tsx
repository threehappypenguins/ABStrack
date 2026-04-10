import React from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { MIN_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';

/**
 * Async UI phase for preset (and similar) screens before data is wired.
 */
export type AsyncScreenStatus = 'loading' | 'error' | 'ready';

export type AsyncScreenContainerProps = {
  /** Current phase; drives which subtree renders. */
  status: AsyncScreenStatus;
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
  loadingAccessibilityLabel = 'Loading',
  errorTitle = 'Something went wrong',
  errorMessage = 'We could not load this screen. Check your connection and try again.',
  onRetry,
  children,
}: AsyncScreenContainerProps) {
  const { colors } = useAppTheme();

  if (status === 'loading') {
    return (
      <View
        style={asyncStyles.centered}
        accessibilityLabel={loadingAccessibilityLabel}
        accessibilityRole="progressbar"
      >
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  if (status === 'error') {
    return (
      <View style={asyncStyles.centered} accessibilityRole="alert">
        <Text
          style={[asyncStyles.errorTitle, { color: colors.ink }]}
          maxFontSizeMultiplier={2}
        >
          {errorTitle}
        </Text>
        <Text
          style={[asyncStyles.errorBody, { color: colors.muted }]}
          maxFontSizeMultiplier={2}
        >
          {errorMessage}
        </Text>
        {onRetry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Try again"
            onPress={onRetry}
            style={({ pressed }) => [
              asyncStyles.retryButton,
              { backgroundColor: colors.primary },
              pressed ? asyncStyles.retryButtonPressed : null,
            ]}
          >
            <Text style={[asyncStyles.retryLabel, { color: colors.onPrimary }]}>
              Try again
            </Text>
          </Pressable>
        ) : null}
      </View>
    );
  }

  return <View style={asyncStyles.readyRoot}>{children}</View>;
}

const asyncStyles = StyleSheet.create({
  readyRoot: {
    flex: 1,
  },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: '600',
    textAlign: 'center',
  },
  errorBody: {
    fontSize: 16,
    textAlign: 'center',
  },
  retryButton: {
    marginTop: 8,
    minHeight: MIN_TOUCH_TARGET_DP,
    minWidth: MIN_TOUCH_TARGET_DP * 3,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
  },
  retryButtonPressed: {
    opacity: 0.85,
  },
  retryLabel: {
    fontSize: 17,
    fontWeight: '600',
  },
});
