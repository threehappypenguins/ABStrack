import React, { useCallback, useMemo } from 'react';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { AppSecondaryMenuButton } from '../components/AppSecondaryMenuButton';
import { EpisodeTemplateCreateScreen } from '../screens/EpisodeTemplateCreateScreen';
import { EpisodeTemplateEditorScreen } from '../screens/EpisodeTemplateEditorScreen';
import { EpisodeTemplateListScreen } from '../screens/EpisodeTemplateListScreen';
import { useAppTheme } from '../theme/AppThemeContext';
import type {
  EpisodeTemplatesStackParamList,
  MainStackParamList,
  MainTabParamList,
} from './types';

const Stack = createNativeStackNavigator<EpisodeTemplatesStackParamList>();

/**
 * Nested stack for episode template list, creation, and editing (symptom + marker pairing).
 *
 * @returns Native stack navigator for the Episode templates tab.
 */
export function EpisodeTemplatesNavigator() {
  const { colors } = useAppTheme();
  const tabNavigation =
    useNavigation<
      BottomTabNavigationProp<MainTabParamList, 'EpisodeTemplates'>
    >();
  const stackNavigation =
    tabNavigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'EpisodeTemplatesNavigator: expected native stack parent for app menu.',
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
      title: 'Episode templates',
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
        name="EpisodeTemplateList"
        component={EpisodeTemplateListScreen}
        options={listScreenOptions}
      />
      <Stack.Screen
        name="EpisodeTemplateCreate"
        component={EpisodeTemplateCreateScreen}
        options={{ title: 'New template' }}
      />
      <Stack.Screen
        name="EpisodeTemplateEdit"
        component={EpisodeTemplateEditorScreen}
        options={{ title: 'Edit template' }}
      />
    </Stack.Navigator>
  );
}
