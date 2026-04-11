import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { SymptomPresetRow } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import {
  fetchSymptomPresets,
  getCurrentUserId,
  removeSymptomPreset,
} from '../../lib/symptom-presets/symptom-preset-service';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import type { SymptomPresetsStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type ListNav = NativeStackNavigationProp<
  SymptomPresetsStackParamList,
  'SymptomPresetList'
>;

/**
 * Lists symptom presets; tap a row to edit, use the trash icon to delete, or add a new preset.
 *
 * @returns List screen for the Symptoms tab stack.
 */
export function SymptomPresetListScreen() {
  const navigation = useNavigation<ListNav>();
  const { colors } = useAppTheme();
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<SymptomPresetRow[]>([]);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    const userId = await getCurrentUserId();
    if (!userId) {
      setErrorMessage('You need to be signed in to manage symptom presets.');
      setStatus('error');
      return;
    }
    const result = await fetchSymptomPresets();
    if (!result.ok) {
      setErrorMessage(result.error.message);
      setStatus('error');
      return;
    }
    setRows(result.data);
    setStatus('ready');
  }, []);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const confirmDelete = (preset: SymptomPresetRow) => {
    Alert.alert(
      'Delete this symptom preset?',
      `“${preset.name}” and all of its symptoms will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await removeSymptomPreset(preset.id);
              if (!result.ok) {
                announce(result.error.message);
                return;
              }
              announce('Symptom preset deleted.');
              await load();
            })();
          },
        },
      ],
    );
  };

  return (
    <AsyncScreenContainer
      status={status}
      errorMessage={errorMessage ?? undefined}
      onRetry={() => {
        void load();
      }}
    >
      <ScrollView
        testID="symptom-preset-list-screen"
        className="flex-1"
        contentContainerStyle={{
          flexGrow: 1,
          padding: 16,
          paddingBottom: 24,
        }}
        keyboardShouldPersistTaps="handled"
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Add symptom preset"
          onPress={() => {
            navigation.navigate('SymptomPresetCreate');
          }}
          className={`mb-4 items-center justify-center rounded-[12px] px-4 active:opacity-90 ${nw.btnPrimary}`}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
        >
          <Text
            className={`text-[17px] font-semibold ${nw.textOnPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Add preset
          </Text>
        </Pressable>

        {rows.length === 0 ? (
          <View
            className={`rounded-xl p-4 ${nw.card}`}
            accessibilityRole="text"
          >
            <Text
              className={`text-base leading-6 ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              You have not created any symptom presets yet. Tap Add preset to
              name a list, then add symptoms and how each should be captured
              during an episode.
            </Text>
          </View>
        ) : (
          <View className="gap-3" accessibilityRole="list">
            {rows.map((preset) => (
              <View
                key={preset.id}
                className={`flex-row items-stretch overflow-hidden rounded-xl ${nw.card}`}
                accessibilityRole="none"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit preset ${preset.name}`}
                  onPress={() => {
                    navigation.navigate('SymptomPresetEdit', {
                      presetId: preset.id,
                    });
                  }}
                  className="min-w-0 flex-1 flex-row items-center px-4 py-3 active:opacity-90"
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                >
                  <Text
                    className={`flex-1 text-[17px] font-medium ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                    numberOfLines={2}
                  >
                    {preset.name}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete preset ${preset.name}`}
                  onPress={() => {
                    confirmDelete(preset);
                  }}
                  className="items-center justify-center px-4 active:opacity-80"
                  style={{
                    minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                    minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                  }}
                  hitSlop={{ top: 8, bottom: 8, left: 4, right: 8 }}
                >
                  <Ionicons
                    name="trash-outline"
                    size={24}
                    color={colors.muted}
                    accessibilityElementsHidden
                    importantForAccessibility="no"
                  />
                </Pressable>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </AsyncScreenContainer>
  );
}
