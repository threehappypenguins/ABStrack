import React, { useCallback } from 'react';
import { Platform, Pressable, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useActionSheet } from '@expo/react-native-action-sheet';
import { Ionicons } from '@expo/vector-icons';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';

const EMPTY_OPTIONS_MESSAGE =
  'No presets in this list yet. Create one in the Symptoms or Markers tab.';

export type PresetOptionSheetOption = { id: string; name: string };

export type PresetOptionSheetFieldProps = {
  label: string;
  placeholderLabel: string;
  options: PresetOptionSheetOption[];
  value: string | null;
  onValueChange: (id: string) => void;
  disabled?: boolean;
  /** Shown as the action sheet subtitle (iOS) / dialog message where supported. */
  hint?: string;
};

/**
 * Tappable row that opens a native **action sheet** (iOS) or the library’s sheet UI (Android) —
 * the usual mobile alternative to a web {@code <select>}. Not an inline dropdown or spinner.
 *
 * @param props - Label, options, current value, and change handler.
 * @returns Labeled control that presents options in a bottom/action sheet.
 */
export function PresetOptionSheetField({
  label,
  placeholderLabel,
  options,
  value,
  onValueChange,
  disabled = false,
  hint = 'Tap to see a list of choices.',
}: PresetOptionSheetFieldProps) {
  const { colors } = useAppTheme();
  const insets = useSafeAreaInsets();
  const { showActionSheetWithOptions } = useActionSheet();

  const selectedName =
    value != null ? options.find((o) => o.id === value)?.name : undefined;
  const summary = selectedName ?? placeholderLabel;
  const mutedSummary = selectedName == null;

  const openSheet = useCallback(() => {
    if (disabled) {
      return;
    }
    if (options.length === 0) {
      announce(EMPTY_OPTIONS_MESSAGE);
      return;
    }

    const sheetOptions = [...options.map((o) => o.name), 'Cancel'];
    const cancelButtonIndex = sheetOptions.length - 1;

    // Custom Android sheet is flush to the screen bottom; without insets the Cancel row
    // can sit in the gesture / 3-button zone and taps go to system UI (recents, etc.).
    const androidBottomPad =
      Platform.OS === 'android' ? Math.max(insets.bottom, 24) : 0;

    showActionSheetWithOptions(
      {
        title: label,
        message: hint,
        options: sheetOptions,
        cancelButtonIndex,
        ...(androidBottomPad > 0
          ? { containerStyle: { paddingBottom: androidBottomPad } }
          : {}),
      },
      (selectedIndex?: number) => {
        if (selectedIndex == null || selectedIndex === cancelButtonIndex) {
          return;
        }
        const chosen = options[selectedIndex];
        if (chosen) {
          onValueChange(chosen.id);
        }
      },
    );
  }, [
    disabled,
    hint,
    insets.bottom,
    label,
    onValueChange,
    options,
    showActionSheetWithOptions,
  ]);

  const listEmpty = options.length === 0;

  return (
    <View className="gap-2">
      <Text
        className={`text-base font-semibold ${nw.textInk}`}
        maxFontSizeMultiplier={2}
        accessibilityRole="text"
      >
        {label}
      </Text>
      <Text className={`text-sm ${nw.textMuted}`} maxFontSizeMultiplier={2}>
        {hint}
      </Text>
      {listEmpty ? (
        <Text
          className={`text-sm ${nw.textMuted}`}
          maxFontSizeMultiplier={2}
          accessibilityRole="text"
        >
          {EMPTY_OPTIONS_MESSAGE}
        </Text>
      ) : null}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${label}. ${summary}. ${
          listEmpty
            ? 'No options yet. Tap to hear this hint again.'
            : 'Opens a list to choose.'
        }`}
        accessibilityState={{ disabled }}
        disabled={disabled}
        onPress={openSheet}
        className={`flex-row items-center justify-between rounded-[10px] px-3 py-3 active:opacity-90 ${nw.card}`}
        style={{
          minHeight: COMFORTABLE_TOUCH_TARGET_DP,
          borderWidth: 1,
          borderColor: colors.border,
          backgroundColor: colors.surface,
          opacity: disabled ? 0.55 : 1,
        }}
      >
        <Text
          className={`min-w-0 flex-1 pr-2 text-[17px] ${mutedSummary ? nw.textMuted : nw.textInk}`}
          numberOfLines={2}
          maxFontSizeMultiplier={2}
        >
          {summary}
        </Text>
        <Ionicons
          name="chevron-down"
          size={22}
          color={colors.muted}
          accessibilityElementsHidden
          importantForAccessibility="no"
        />
      </Pressable>
    </View>
  );
}
