import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SymptomResponseType } from '@abstrack/types';
import { SYMPTOM_RESPONSE_TYPES } from '@abstrack/types';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { getSymptomResponseTypeLabel } from '../../../lib/symptom-presets/response-type-labels';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';

export type SymptomResponseTypePickerProps = {
  value: SymptomResponseType;
  onChange: (next: SymptomResponseType) => void;
  disabled: boolean;
};

/**
 * Large touch targets for each response type; behaves like a radio group.
 *
 * @param props - Current value, change handler, and disabled state.
 * @returns Radio-style list for {@link SymptomResponseType} values.
 */
export function SymptomResponseTypePicker({
  value,
  onChange,
  disabled,
}: SymptomResponseTypePickerProps) {
  const { colors } = useAppTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Response type"
      className="gap-2"
    >
      {SYMPTOM_RESPONSE_TYPES.map((t) => {
        const selected = value === t;
        return (
          <Pressable
            key={t}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={getSymptomResponseTypeLabel(t)}
            disabled={disabled}
            onPress={() => {
              onChange(t);
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
              {getSymptomResponseTypeLabel(t)}
            </Text>
            {selected ? (
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.primary}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}
