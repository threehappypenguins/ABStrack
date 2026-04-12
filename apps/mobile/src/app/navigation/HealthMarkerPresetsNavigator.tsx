import React, { useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { HealthMarkerPresetCreateScreen } from '../screens/HealthMarkerPresetCreateScreen';
import { HealthMarkerPresetEditorScreen } from '../screens/HealthMarkerPresetEditorScreen';
import { HealthMarkerPresetListScreen } from '../screens/HealthMarkerPresetListScreen';
import { useAppTheme } from '../theme/AppThemeContext';
import type { HealthMarkerPresetsStackParamList } from './types';

const Stack = createNativeStackNavigator<HealthMarkerPresetsStackParamList>();

/**
 * Nested stack for health marker preset list, creation, and line editing.
 *
 * @returns Native stack navigator for the Markers tab.
 */
export function HealthMarkerPresetsNavigator() {
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
        name="HealthMarkerPresetList"
        component={HealthMarkerPresetListScreen}
        options={{ title: 'Health marker presets' }}
      />
      <Stack.Screen
        name="HealthMarkerPresetCreate"
        component={HealthMarkerPresetCreateScreen}
        options={{ title: 'New preset' }}
      />
      <Stack.Screen
        name="HealthMarkerPresetEdit"
        component={HealthMarkerPresetEditorScreen}
        options={{ title: 'Edit preset' }}
      />
    </Stack.Navigator>
  );
}
