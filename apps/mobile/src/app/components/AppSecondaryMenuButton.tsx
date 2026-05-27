import React, { useCallback } from 'react';
import { Platform, Pressable } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActionSheet } from '@expo/react-native-action-sheet';
import { Ionicons } from '@expo/vector-icons';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../theme/AppThemeContext';
import { buildThemedActionSheetOptions } from '../lib/build-themed-action-sheet-options';

export type AppSecondaryMenuButtonProps = {
  /** Opens the standalone Manage screen. */
  onGoToManage: () => void;
  /** Opens the standalone Settings screen. */
  onGoToSettings: () => void;
};

/**
 * Header action that opens the app's secondary navigation menu in a native action sheet.
 *
 * @param props - Secondary destination callbacks.
 * @returns Pressable icon button for authenticated mobile screens.
 */
export function AppSecondaryMenuButton({
  onGoToManage,
  onGoToSettings,
}: AppSecondaryMenuButtonProps) {
  const { colorScheme, colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { showActionSheetWithOptions } = useActionSheet();

  const openMenu = useCallback(() => {
    const options = ['Manage', 'Settings', 'Cancel'];
    const cancelButtonIndex = options.length - 1;
    const androidBottomPad =
      Platform.OS === 'android' ? Math.max(insets.bottom, 24) : 0;

    showActionSheetWithOptions(
      buildThemedActionSheetOptions({
        title: 'Menu',
        options,
        cancelButtonIndex,
        colors,
        colorScheme,
        containerStyle:
          androidBottomPad > 0
            ? { paddingBottom: androidBottomPad }
            : undefined,
      }),
      (selectedIndex?: number) => {
        if (selectedIndex === 0) {
          onGoToManage();
          return;
        }
        if (selectedIndex === 1) {
          onGoToSettings();
        }
      },
    );
  }, [
    colorScheme,
    colors,
    insets.bottom,
    onGoToManage,
    onGoToSettings,
    showActionSheetWithOptions,
  ]);

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open app menu"
      accessibilityHint="Opens navigation for Manage and Settings."
      onPress={openMenu}
      hitSlop={8}
      style={({ pressed }) => ({
        minWidth: COMFORTABLE_TOUCH_TARGET_DP,
        minHeight: COMFORTABLE_TOUCH_TARGET_DP,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: COMFORTABLE_TOUCH_TARGET_DP / 2,
        opacity: pressed ? 0.72 : 1,
      })}
    >
      <Ionicons
        name="ellipsis-horizontal"
        size={22}
        color={colors.ink}
        accessibilityElementsHidden
        importantForAccessibility="no"
      />
    </Pressable>
  );
}
