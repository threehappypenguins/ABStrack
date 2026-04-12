import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type { PresetSymptomRow, SymptomResponseType } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';
import { SymptomResponseTypePicker } from './SymptomResponseTypePicker';

export type SymptomLineCardProps = {
  line: PresetSymptomRow;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRequestRemove: () => void;
  onResponseTypeChange: (next: SymptomResponseType) => void;
  onNameCommit: (draft: string) => void;
  onPromptCommit: (draft: string | null) => void;
};

/**
 * One reorderable symptom row: name, response type, optional media instruction, move/remove.
 *
 * @param props - Line data and callbacks.
 * @returns Card UI for a single preset symptom line.
 */
export function SymptomLineCard({
  line,
  index,
  total,
  disabled,
  onMove,
  onRequestRemove,
  onResponseTypeChange,
  onNameCommit,
  onPromptCommit,
}: SymptomLineCardProps) {
  const { colors } = useAppTheme();
  const [nameDraft, setNameDraft] = useState(line.symptom_name);
  const [promptDraft, setPromptDraft] = useState(line.prompt_instruction ?? '');

  useEffect(() => {
    setNameDraft(line.symptom_name);
  }, [line.symptom_name]);

  useEffect(() => {
    setPromptDraft(line.prompt_instruction ?? '');
  }, [line.prompt_instruction]);

  const pos = index + 1;
  const showMediaPrompt =
    line.response_type === 'photo' || line.response_type === 'video';

  return (
    <View
      className={`gap-3 rounded-xl p-4 ${nw.card}`}
      accessibilityRole="none"
    >
      <Text
        className={`text-sm font-semibold ${nw.textMuted}`}
        maxFontSizeMultiplier={2}
      >
        Symptom {pos} of {total}
      </Text>

      <View className="gap-1">
        <Text
          className={`text-base font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Symptom name
        </Text>
        <TextInput
          value={nameDraft}
          editable={!disabled}
          onChangeText={setNameDraft}
          onBlur={() => {
            const trimmed = nameDraft.trim();
            if (!trimmed) {
              setNameDraft(line.symptom_name);
              announce('Symptom name cannot be empty. Restored previous name.');
              return;
            }
            onNameCommit(nameDraft);
          }}
          className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          maxFontSizeMultiplier={2}
          accessibilityLabel={`Symptom ${pos} name`}
        />
      </View>

      <View className="gap-2">
        <Text
          className={`text-base font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Response type
        </Text>
        <SymptomResponseTypePicker
          value={line.response_type}
          disabled={disabled}
          onChange={onResponseTypeChange}
        />
      </View>

      {showMediaPrompt ? (
        <View className="gap-1">
          <Text
            className={`text-base font-semibold ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Instruction during photo or video (optional)
          </Text>
          <Text className={`text-sm ${nw.textMuted}`} maxFontSizeMultiplier={2}>
            Shown when the episode flow asks for this photo or video.
          </Text>
          <TextInput
            value={promptDraft}
            editable={!disabled}
            onChangeText={setPromptDraft}
            onBlur={() => {
              onPromptCommit(promptDraft);
            }}
            placeholder='e.g. "Say: The early bird catches the worm"'
            placeholderTextColor={colors.inputPlaceholder}
            multiline
            className={`rounded-[10px] px-3 py-3 text-[16px] ${nw.input}`}
            maxFontSizeMultiplier={2}
            accessibilityLabel={`Symptom ${pos} capture instruction`}
          />
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move symptom ${pos} up`}
          disabled={disabled || index === 0}
          onPress={() => {
            onMove(-1);
          }}
          className={`flex-1 items-center justify-center rounded-[10px] border px-2 py-3 active:opacity-90 ${nw.btnSecondary}`}
          style={{
            minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            minWidth: 120,
            opacity: disabled || index === 0 ? 0.45 : 1,
          }}
        >
          <Text
            className={`text-center text-[16px] font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Move up
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move symptom ${pos} down`}
          disabled={disabled || index >= total - 1}
          onPress={() => {
            onMove(1);
          }}
          className={`flex-1 items-center justify-center rounded-[10px] border px-2 py-3 active:opacity-90 ${nw.btnSecondary}`}
          style={{
            minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            minWidth: 120,
            opacity: disabled || index >= total - 1 ? 0.45 : 1,
          }}
        >
          <Text
            className={`text-center text-[16px] font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Move down
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove symptom ${line.symptom_name}`}
        disabled={disabled}
        onPress={onRequestRemove}
        className="items-center justify-center rounded-[10px] border border-red-300 bg-red-50 px-3 py-3 active:opacity-90 dark:border-red-800 dark:bg-red-950/40"
        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
      >
        <Text
          className="text-[16px] font-semibold text-red-800 dark:text-red-200"
          maxFontSizeMultiplier={2}
        >
          Remove symptom
        </Text>
      </Pressable>
    </View>
  );
}
