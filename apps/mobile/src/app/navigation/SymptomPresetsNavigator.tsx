import React, { useCallback, useMemo } from 'react';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppSecondaryMenuButton } from '../components/AppSecondaryMenuButton';
import { SymptomPresetCreateScreen } from '../screens/SymptomPresetCreateScreen';
import { SymptomPresetEditorScreen } from '../screens/SymptomPresetEditorScreen';
import { SymptomPresetListScreen } from '../screens/SymptomPresetListScreen';
import { useAppTheme } from '../theme/AppThemeContext';
import type {
  MainStackParamList,
  MainTabParamList,
  SymptomPresetsStackParamList,
} from './types';

const Stack = createNativeStackNavigator<SymptomPresetsStackParamList>();

/**
 * Nested stack for symptom preset list, creation, and line editing (response types and reorder).
 *
 * @returns Native stack navigator for the Symptoms tab.
 */
export function SymptomPresetsNavigator() {
  const { colors } = useAppTheme();
  const tabNavigation =
    useNavigation<
      BottomTabNavigationProp<MainTabParamList, 'SymptomPresets'>
    >();
  const stackNavigation =
    tabNavigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'SymptomPresetsNavigator: expected native stack parent for app menu.',
    );
  }

  const openManage = useCallback(() => {
    stackNavigation.navigate('Manage');
  }, [stackNavigation]);

  const openSettings = useCallback(() => {
    stackNavigation.navigate('Settings');
  }, [stackNavigation]);

  const screenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.primary,
      headerTitleStyle: { color: colors.ink, fontWeight: '600' as const },
      contentStyle: { backgroundColor: colors.bg },
    }),
    [colors],
  );

  const listScreenOptions = useMemo(
    () => ({
      title: 'Symptom presets',
      headerRight: () => (
        <AppSecondaryMenuButton
          onGoToManage={openManage}
          onGoToSettings={openSettings}
        />
      ),
    }),
    [openManage, openSettings],
  );

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="SymptomPresetList"
        component={SymptomPresetListScreen}
        options={listScreenOptions}
      />
      <Stack.Screen
        name="SymptomPresetCreate"
        component={SymptomPresetCreateScreen}
        options={{ title: 'New preset' }}
      />
      <Stack.Screen
        name="SymptomPresetEdit"
        component={SymptomPresetEditorScreen}
        options={{ title: 'Edit preset' }}
      />
    </Stack.Navigator>
  );
}
