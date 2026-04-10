import { useMemo } from 'react';
import { StyleSheet } from 'react-native';
import type { AppThemeColors } from './theme/app-colors';
import { useAppTheme } from './theme/AppThemeContext';

/**
 * Builds authenticated and auth form styles from semantic app colors (web `global.css` parity).
 *
 * @param colors - Palette for the active color scheme.
 * @returns StyleSheet map used across screens.
 */
export function createAppStyles(colors: AppThemeColors) {
  return StyleSheet.create({
    homeScrollContent: {
      flexGrow: 1,
      padding: 16,
      justifyContent: 'center',
    },
    container: {
      flex: 1,
      backgroundColor: colors.bg,
      justifyContent: 'center',
      padding: 16,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.bg,
    },
    card: {
      backgroundColor: colors.surface,
      borderRadius: 12,
      padding: 16,
      gap: 12,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.border,
      shadowColor: colors.shadow,
      shadowOffset: { width: 0, height: 1 },
      shadowOpacity: colors.shadowOpacity,
      shadowRadius: 4,
      elevation: 2,
    },
    title: {
      fontSize: 22,
      fontWeight: '600',
      color: colors.ink,
    },
    labelText: {
      fontSize: 16,
      fontWeight: '600',
      color: colors.ink,
    },
    bodyText: {
      fontSize: 16,
      color: colors.muted,
    },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      minHeight: 52,
      color: colors.ink,
      backgroundColor: colors.surface,
    },
    errorText: {
      color: colors.error,
      fontSize: 14,
    },
    infoText: {
      color: colors.info,
      fontSize: 14,
    },
    primaryButton: {
      backgroundColor: colors.primary,
      borderRadius: 10,
      minHeight: 52,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
    },
    primaryButtonDisabled: {
      opacity: 0.6,
    },
    primaryButtonText: {
      color: colors.onPrimary,
      fontSize: 18,
      fontWeight: '700',
    },
    secondaryButton: {
      borderRadius: 10,
      borderWidth: 1,
      borderColor: colors.primary,
      minHeight: 52,
      paddingHorizontal: 16,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    secondaryButtonText: {
      color: colors.primary,
      fontSize: 17,
      fontWeight: '600',
      textAlign: 'center',
    },
    tertiaryButton: {
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: 32,
    },
    tertiaryButtonText: {
      color: colors.primary,
      fontSize: 15,
      fontWeight: '500',
      textAlign: 'center',
    },
    spacer: {
      height: 8,
    },
    settingRow: {
      alignItems: 'center',
      flexDirection: 'row',
      gap: 12,
    },
    settingTextBlock: {
      flex: 1,
      gap: 6,
    },
    healthCheckContainer: {
      marginVertical: 12,
      padding: 12,
      borderRadius: 8,
      borderWidth: 1,
    },
    healthCheckContainerSuccess: {
      borderColor: colors.healthSuccessBorder,
      backgroundColor: colors.healthSuccessBg,
    },
    healthCheckContainerFailure: {
      borderColor: colors.healthFailureBorder,
      backgroundColor: colors.healthFailureBg,
    },
    healthCheckTitleText: {
      fontSize: 14,
      fontWeight: '600',
      marginBottom: 4,
    },
    healthCheckTitleTextSuccess: {
      color: colors.healthSuccessTitle,
    },
    healthCheckTitleTextFailure: {
      color: colors.healthFailureTitle,
    },
    healthCheckBodyText: {
      fontSize: 12,
    },
    healthCheckBodyTextSuccess: {
      color: colors.healthSuccessBody,
    },
    healthCheckBodyTextFailure: {
      color: colors.healthFailureBody,
    },
    healthCheckErrorText: {
      fontSize: 10,
      marginTop: 8,
      fontFamily: 'monospace',
    },
    healthCheckErrorTextSuccess: {
      color: colors.healthSuccessBody,
    },
    healthCheckErrorTextFailure: {
      color: colors.healthFailureBody,
    },
  });
}

/**
 * Hook returning memoized styles for the active {@link useAppTheme} palette.
 *
 * @returns Styles keyed like the former static `styles` export.
 */
export function useAppStyles() {
  const { colors } = useAppTheme();
  return useMemo(() => createAppStyles(colors), [colors]);
}
