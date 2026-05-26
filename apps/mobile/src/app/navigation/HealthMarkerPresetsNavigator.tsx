import React, { useCallback, useMemo } from 'react';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppSecondaryMenuButton } from '../components/AppSecondaryMenuButton';
import { HealthMarkerPresetCreateScreen } from '../screens/HealthMarkerPresetCreateScreen';
import { HealthMarkerPresetEditorScreen } from '../screens/HealthMarkerPresetEditorScreen';
import { HealthMarkerPresetListScreen } from '../screens/HealthMarkerPresetListScreen';
import { useAppTheme } from '../theme/AppThemeContext';
import type {
  HealthMarkerPresetsStackParamList,
  MainStackParamList,
  MainTabParamList,
} from './types';

const Stack = createNativeStackNavigator<HealthMarkerPresetsStackParamList>();

/**
 * Nested stack for health marker preset list, creation, and line editing.
 *
 * @returns Native stack navigator for the Markers tab.
 */
export function HealthMarkerPresetsNavigator() {
  const { colors } = useAppTheme();
  const tabNavigation =
    useNavigation<
      BottomTabNavigationProp<MainTabParamList, 'HealthMarkerPresets'>
    >();
  const stackNavigation =
    tabNavigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'HealthMarkerPresetsNavigator: expected native stack parent for app menu.',
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
      title: 'Health marker presets',
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
        name="HealthMarkerPresetList"
        component={HealthMarkerPresetListScreen}
        options={listScreenOptions}
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
