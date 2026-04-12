import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PresetHealthMarkerKind } from '@abstrack/types';
import {
  PRESET_HEALTH_MARKER_KINDS,
  PRESET_HEALTH_MARKER_KIND_LABELS,
} from '@abstrack/types';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';

export type HealthMarkerKindPickerProps = {
  value: PresetHealthMarkerKind;
  onChange: (next: PresetHealthMarkerKind) => void;
  disabled: boolean;
};

/**
 * Large touch targets for each marker kind; behaves like a radio group.
 *
 * @param props - Current value, change handler, and disabled state.
 * @returns Radio-style list for {@link PresetHealthMarkerKind} values.
 */
export function HealthMarkerKindPicker({
  value,
  onChange,
  disabled,
}: HealthMarkerKindPickerProps) {
  const { colors } = useAppTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Marker type"
      className="gap-2"
    >
      {PRESET_HEALTH_MARKER_KINDS.map((k) => {
        const selected = value === k;
        return (
          <Pressable
            key={k}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={PRESET_HEALTH_MARKER_KIND_LABELS[k]}
            disabled={disabled}
            onPress={() => {
              onChange(k);
            }}
            className={`flex-row items-center justify-between rounded-[10px] px-3 py-3 active:opacity-90 ${nw.card}`}
            style={{
              minHeight: COMFORTABLE_TOUCH_TARGET_DP,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? colors.primary : colors.border,
            }}
          >
            <Text
              className={`flex-1 text-[16px] ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {PRESET_HEALTH_MARKER_KIND_LABELS[k]}
            </Text>
            {selected ? (
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.primary}
                accessibilityElementsHidden
                importantForAccessibility="no"
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
