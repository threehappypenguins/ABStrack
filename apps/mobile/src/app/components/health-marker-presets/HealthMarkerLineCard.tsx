import React, { useEffect, useState } from 'react';
import { Pressable, Text, TextInput, View } from 'react-native';
import type {
  PresetHealthMarkerKind,
  PresetHealthMarkerRow,
} from '@abstrack/types';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useAppTheme } from '../../theme/AppThemeContext';
import { nw } from '../../theme/app-nativewind-classes';
import { HealthMarkerKindPicker } from './HealthMarkerKindPicker';

export type HealthMarkerLineCardProps = {
  line: PresetHealthMarkerRow;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRequestRemove: () => void;
  onMarkerKindChange: (
    line: PresetHealthMarkerRow,
    next: PresetHealthMarkerKind,
  ) => void;
  onCustomFieldsCommit: (
    line: PresetHealthMarkerRow,
    nameDraft: string,
    unitDraft: string,
  ) => void;
};

/**
 * One reorderable health marker row: kind picker, optional custom name/unit, move/remove.
 *
 * @param props - Line data and callbacks.
 * @returns Card UI for a single preset health marker line.
 */
export function HealthMarkerLineCard({
  line,
  index,
  total,
  disabled,
  onMove,
  onRequestRemove,
  onMarkerKindChange,
  onCustomFieldsCommit,
}: HealthMarkerLineCardProps) {
  const { colors } = useAppTheme();
  const [nameDraft, setNameDraft] = useState(line.custom_name ?? '');
  const [unitDraft, setUnitDraft] = useState(line.custom_unit ?? '');

  useEffect(() => {
    setNameDraft(line.custom_name ?? '');
  }, [line.custom_name]);

  useEffect(() => {
    setUnitDraft(line.custom_unit ?? '');
  }, [line.custom_unit]);

  const pos = index + 1;
  const showCustom = line.marker_kind === 'custom';

  return (
    <View
      className={`gap-3 rounded-xl p-4 ${nw.card}`}
      accessibilityRole="none"
    >
      <Text
        className={`text-sm font-semibold ${nw.textMuted}`}
        maxFontSizeMultiplier={2}
      >
        Marker {pos} of {total}
      </Text>

      <View className="gap-2">
        <Text
          className={`text-base font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Marker type
        </Text>
        <HealthMarkerKindPicker
          value={line.marker_kind}
          disabled={disabled}
          onChange={(next) => {
            onMarkerKindChange(line, next);
          }}
        />
      </View>

      {showCustom ? (
        <View className="gap-3">
          <View className="gap-1">
            <Text
              className={`text-base font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Custom name
            </Text>
            <TextInput
              value={nameDraft}
              editable={!disabled}
              onChangeText={setNameDraft}
              onBlur={() => {
                void onCustomFieldsCommit(line, nameDraft, unitDraft);
              }}
              placeholder="e.g. Ketones"
              placeholderTextColor={colors.inputPlaceholder}
              className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              maxFontSizeMultiplier={2}
              accessibilityLabel={`Marker ${pos} custom name`}
            />
          </View>
          <View className="gap-1">
            <Text
              className={`text-base font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Unit
            </Text>
            <TextInput
              value={unitDraft}
              editable={!disabled}
              onChangeText={setUnitDraft}
              onBlur={() => {
                void onCustomFieldsCommit(line, nameDraft, unitDraft);
              }}
              placeholder="e.g. mmol/L"
              placeholderTextColor={colors.inputPlaceholder}
              className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              maxFontSizeMultiplier={2}
              accessibilityLabel={`Marker ${pos} unit`}
            />
          </View>
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move marker ${pos} up`}
          disabled={disabled || index === 0}
          onPress={() => {
            onMove(-1);
          }}
          className={`min-w-[120px] flex-1 items-center justify-center rounded-[10px] border px-3 py-3 active:opacity-90 ${nw.btnSecondary}`}
          style={{
            minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            opacity: disabled || index === 0 ? 0.45 : 1,
          }}
        >
          <Text className={`text-[16px] font-semibold ${nw.textInk}`}>
            Move up
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move marker ${pos} down`}
          disabled={disabled || index >= total - 1}
          onPress={() => {
            onMove(1);
          }}
          className={`min-w-[120px] flex-1 items-center justify-center rounded-[10px] border px-3 py-3 active:opacity-90 ${nw.btnSecondary}`}
          style={{
            minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            opacity: disabled || index >= total - 1 ? 0.45 : 1,
          }}
        >
          <Text className={`text-[16px] font-semibold ${nw.textInk}`}>
            Move down
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove marker ${pos}`}
        disabled={disabled}
        onPress={() => {
          onRequestRemove();
        }}
        className={`items-center justify-center rounded-[10px] border border-red-300 px-3 py-3 active:opacity-90 dark:border-red-800`}
        style={{
          minHeight: COMFORTABLE_TOUCH_TARGET_DP,
          opacity: disabled ? 0.45 : 1,
        }}
      >
        <Text className="text-[16px] font-semibold text-red-700 dark:text-red-300">
          Remove marker
        </Text>
      </Pressable>
    </View>
  );
}
