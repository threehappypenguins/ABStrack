import React, { useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { SymptomPresetCreateScreen } from '../screens/SymptomPresetCreateScreen';
import { SymptomPresetEditorScreen } from '../screens/SymptomPresetEditorScreen';
import { SymptomPresetListScreen } from '../screens/SymptomPresetListScreen';
import { useAppTheme } from '../theme/AppThemeContext';
import type { SymptomPresetsStackParamList } from './types';

const Stack = createNativeStackNavigator<SymptomPresetsStackParamList>();

/**
 * Nested stack for symptom preset list, creation, and line editing (response types and reorder).
 *
 * @returns Native stack navigator for the Symptoms tab.
 */
export function SymptomPresetsNavigator() {
  const { colors } = useAppTheme();

  const screenOptions = useMemo(
    () => ({
      headerStyle: { backgroundColor: colors.surface },
      headerTintColor: colors.primary,
      headerTitleStyle: { color: colors.ink, fontWeight: '600' as const },
      contentStyle: { backgroundColor: colors.bg },
    }),
    [colors],
  );

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="SymptomPresetList"
        component={SymptomPresetListScreen}
        options={{ title: 'Symptom presets' }}
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
