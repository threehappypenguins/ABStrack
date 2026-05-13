import React, { useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { resolveMobilePhiSubjectUserContext } from '../../lib/phi-subject/resolve-mobile-phi-subject-user-context';
import { saveNewHealthMarkerPreset } from '../../lib/health-marker-presets/health-marker-preset-service';
import type { HealthMarkerPresetsStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type CreateNav = NativeStackNavigationProp<
  HealthMarkerPresetsStackParamList,
  'HealthMarkerPresetCreate'
>;

/**
 * Creates an empty health marker preset header, then opens the editor for lines.
 *
 * @returns Create preset screen.
 */
export function HealthMarkerPresetCreateScreen() {
  const navigation = useNavigation<CreateNav>();
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const onCreate = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      announce('Enter a name for this preset.');
      return;
    }
    setBusy(true);
    try {
      const phiRes = await resolveMobilePhiSubjectUserContext();
      if (!phiRes.ok) {
        announce(phiRes.error.message);
        return;
      }
      if (phiRes.data == null) {
        announce('You need to be signed in to create a preset.');
        return;
      }
      const userId = phiRes.data.phiSubjectUserId;
      const result = await saveNewHealthMarkerPreset({
        user_id: userId,
        name: trimmed,
      });
      if (!result.ok) {
        announce(result.error.message);
        return;
      }
      navigation.replace('HealthMarkerPresetEdit', {
        presetId: result.data.id,
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        flexGrow: 1,
        padding: 16,
        paddingBottom: 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <View className="gap-2">
        <Text className={`text-base ${nw.textMuted}`} maxFontSizeMultiplier={2}>
          Name your preset. You will add markers and types on the next screen.
        </Text>
        <Text
          accessibilityRole="text"
          className={`text-base font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Preset name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          editable={!busy}
          placeholder="e.g. Morning vitals"
          placeholderTextColor={colors.inputPlaceholder}
          className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          autoCapitalize="sentences"
          autoCorrect
          maxFontSizeMultiplier={2}
          accessibilityLabel="Preset name"
        />
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Create preset and continue"
        accessibilityState={{ disabled: busy }}
        disabled={busy}
        onPress={() => {
          void onCreate();
        }}
        className={`mt-6 items-center justify-center rounded-[12px] px-4 active:opacity-90 ${nw.btnPrimary}`}
        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
      >
        <Text
          className={`text-[17px] font-semibold ${nw.textOnPrimary}`}
          maxFontSizeMultiplier={2}
        >
          {busy ? 'Creating…' : 'Create and edit markers'}
        </Text>
      </Pressable>
    </ScrollView>
  );
}
