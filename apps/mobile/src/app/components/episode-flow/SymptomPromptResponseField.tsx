import React from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PresetSymptomRow, SymptomPromptAnswer } from '@abstrack/types';
import { createDefaultSymptomPromptAnswer } from '@abstrack/types';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';

export type SymptomPromptResponseFieldProps = {
  line: PresetSymptomRow;
  answer: SymptomPromptAnswer | undefined;
  onChange: (next: SymptomPromptAnswer) => void;
  disabled: boolean;
};

/**
 * Renders the capture UI for one preset symptom line (Week 5 skeleton: no media pipeline).
 *
 * @param props - Line metadata, current answer, change handler, disabled flag.
 * @returns Response-type-specific controls.
 */
export function SymptomPromptResponseField({
  line,
  answer,
  onChange,
  disabled,
}: SymptomPromptResponseFieldProps) {
  const { colors } = useAppTheme();
  const effective =
    answer ?? createDefaultSymptomPromptAnswer(line.response_type);

  switch (line.response_type) {
    case 'yes_no': {
      const v = effective.type === 'yes_no' ? effective.value : null;
      return (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`${line.symptom_name} yes or no`}
          className="gap-3"
        >
          {(['yes', 'no'] as const).map((which) => {
            const boolVal = which === 'yes';
            const selected = v === boolVal;
            return (
              <Pressable
                key={which}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  onChange({
                    type: 'yes_no',
                    value: selected ? null : boolVal,
                  });
                }}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                className={`items-center justify-center rounded-xl border-2 px-4 py-4 active:opacity-90 ${
                  selected
                    ? 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                    : 'border-app-border bg-app-bg dark:border-app-border-dark dark:bg-app-bg-dark'
                }`}
              >
                <Text
                  className={`text-[17px] font-semibold capitalize ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {which}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case 'severity_scale': {
      const sev = effective.type === 'severity_scale' ? effective.value : null;
      return (
        <View
          accessibilityRole="radiogroup"
          accessibilityLabel={`${line.symptom_name} severity 1 to 5`}
          className="flex-row flex-wrap gap-2"
        >
          {[1, 2, 3, 4, 5].map((n) => {
            const selected = sev === n;
            return (
              <Pressable
                key={n}
                accessibilityRole="radio"
                accessibilityLabel={`Severity ${n}`}
                accessibilityState={{ selected, disabled }}
                disabled={disabled}
                onPress={() => {
                  onChange({
                    type: 'severity_scale',
                    value: selected ? null : n,
                  });
                }}
                style={{
                  minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                  minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                }}
                className={`items-center justify-center rounded-xl border-2 px-3 py-3 active:opacity-90 ${
                  selected
                    ? 'border-red-600 bg-red-50 dark:border-red-500 dark:bg-red-950/40'
                    : 'border-app-border bg-app-bg dark:border-app-border-dark dark:bg-app-bg-dark'
                }`}
              >
                <Text
                  className={`text-[17px] font-semibold ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {n}
                </Text>
              </Pressable>
            );
          })}
        </View>
      );
    }
    case 'free_text': {
      const text = effective.type === 'free_text' ? effective.value : '';
      return (
        <TextInput
          editable={!disabled}
          accessibilityLabel={`${line.symptom_name} notes`}
          multiline
          value={text}
          onChangeText={(t) => {
            onChange({ type: 'free_text', value: t });
          }}
          placeholder="Type a short note (optional)"
          placeholderTextColor={colors.inputPlaceholder}
          className={`min-h-[120px] rounded-xl border border-app-border bg-white p-4 text-[17px] text-app-ink dark:border-app-border-dark dark:bg-app-bg-dark ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        />
      );
    }
    case 'photo':
      return (
        <View
          accessibilityRole="text"
          className="rounded-xl border border-dashed border-app-border bg-app-bg p-6 dark:border-app-border-dark dark:bg-app-bg-dark"
        >
          <Text
            className={`text-center text-base leading-relaxed ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Photo symptom capture is coming in a later update. For now, use Next
            or Skip to continue this episode flow.
          </Text>
        </View>
      );
    case 'video':
      return (
        <View
          accessibilityRole="text"
          className="rounded-xl border border-dashed border-app-border bg-app-bg p-6 dark:border-app-border-dark dark:bg-app-bg-dark"
        >
          <Text
            className={`text-center text-base leading-relaxed ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Video symptom capture is coming in a later update. For now, use Next
            or Skip to continue this episode flow.
          </Text>
        </View>
      );
    default: {
      const _exhaustive: never = line.response_type;
      return _exhaustive;
    }
  }
}
