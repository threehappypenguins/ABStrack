import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { HealthMarkerPresetRow } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import {
  fetchHealthMarkerPresets,
  getCurrentUserId,
  removeHealthMarkerPreset,
} from '../../lib/health-marker-presets/health-marker-preset-service';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import type { HealthMarkerPresetsStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

/** Token for focus-scoped list loads; `useFocusEffect` cleanup sets `cancelled`. */
type FocusLoadCancel = { cancelled: boolean };

type ListNav = NativeStackNavigationProp<
  HealthMarkerPresetsStackParamList,
  'HealthMarkerPresetList'
>;

/**
 * Lists health marker presets; tap a row to edit, use the trash icon to delete, or add a new preset.
 *
 * @returns List screen for the Markers tab stack.
 */
export function HealthMarkerPresetListScreen() {
  const navigation = useNavigation<ListNav>();
  const { colors } = useAppTheme();
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<HealthMarkerPresetRow[]>([]);

  const load = useCallback(async (focusCancel?: FocusLoadCancel) => {
    const stale = () => focusCancel?.cancelled === true;

    setStatus('loading');
    setErrorMessage(null);
    const authResult = await getCurrentUserId();
    if (stale()) {
      return;
    }
    if (!authResult.ok) {
      setErrorMessage(authResult.error.message);
      setStatus('error');
      return;
    }
    if (authResult.data === null) {
      setErrorMessage(
        'You need to be signed in to manage health marker presets.',
      );
      setStatus('error');
      return;
    }
    const result = await fetchHealthMarkerPresets();
    if (stale()) {
      return;
    }
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
      const focusCancel: FocusLoadCancel = { cancelled: false };
      void load(focusCancel);
      return () => {
        focusCancel.cancelled = true;
      };
    }, [load]),
  );

  const confirmDelete = (preset: HealthMarkerPresetRow) => {
    Alert.alert(
      'Delete this health marker preset?',
      `“${preset.name}” and all of its markers will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await removeHealthMarkerPreset(preset.id);
              if (!result.ok) {
                announce(result.error.message);
                return;
              }
              announce('Health marker preset deleted.');
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
        testID="health-marker-preset-list-screen"
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
          accessibilityLabel="Add health marker preset"
          onPress={() => {
            navigation.navigate('HealthMarkerPresetCreate');
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
              You have not created any health marker presets yet. Tap Add preset
              to name a list, then add markers such as glucose, blood pressure,
              or a custom measurement.
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
                    navigation.navigate('HealthMarkerPresetEdit', {
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
