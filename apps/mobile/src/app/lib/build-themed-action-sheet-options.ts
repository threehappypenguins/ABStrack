import type { AppColorScheme } from '../theme/AppThemeContext';
import type { AppThemeColors } from '../theme/app-colors';

export type ThemedActionSheetConfig = {
  title?: string;
  message?: string;
  options: string[];
  cancelButtonIndex?: number;
  destructiveButtonIndex?: number | number[];
  disabledButtonIndices?: number[];
  colors: AppThemeColors;
  colorScheme: AppColorScheme;
  containerStyle?: {
    paddingBottom?: number;
  };
};

/**
 * Builds action-sheet options that follow the app's semantic light/dark tokens.
 *
 * Android/Web use the library's custom sheet, so these styles theme the container,
 * separators, and text directly. iOS still uses the native sheet, but
 * `userInterfaceStyle` and tint colors keep it aligned with the selected appearance.
 *
 * @param config - Base sheet content plus semantic app colors and optional container padding.
 * @returns Action sheet options object suitable for `showActionSheetWithOptions`.
 */
export function buildThemedActionSheetOptions({
  title,
  message,
  options,
  cancelButtonIndex,
  destructiveButtonIndex,
  disabledButtonIndices,
  colors,
  colorScheme,
  containerStyle,
}: ThemedActionSheetConfig) {
  return {
    title,
    message,
    options,
    cancelButtonIndex,
    destructiveButtonIndex,
    disabledButtonIndices,
    userInterfaceStyle: colorScheme,
    tintColor: colors.ink,
    cancelButtonTintColor: colors.primary,
    destructiveColor: colors.error,
    textStyle: {
      color: colors.ink,
    },
    titleTextStyle: {
      color: colors.muted,
    },
    messageTextStyle: {
      color: colors.muted,
    },
    showSeparators: true,
    containerStyle: {
      backgroundColor: colors.surface,
      ...containerStyle,
    },
    separatorStyle: {
      backgroundColor: colors.border,
    },
  };
}
