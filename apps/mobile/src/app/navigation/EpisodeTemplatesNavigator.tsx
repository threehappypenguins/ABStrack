import React, { useMemo } from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { EpisodeTemplateCreateScreen } from '../screens/EpisodeTemplateCreateScreen';
import { EpisodeTemplateEditorScreen } from '../screens/EpisodeTemplateEditorScreen';
import { EpisodeTemplateListScreen } from '../screens/EpisodeTemplateListScreen';
import { useAppTheme } from '../theme/AppThemeContext';
import type { EpisodeTemplatesStackParamList } from './types';

const Stack = createNativeStackNavigator<EpisodeTemplatesStackParamList>();

/**
 * Nested stack for episode template list, creation, and editing (symptom + marker pairing).
 *
 * @returns Native stack navigator for the Episode templates tab.
 */
export function EpisodeTemplatesNavigator() {
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
        name="EpisodeTemplateList"
        component={EpisodeTemplateListScreen}
        options={{ title: 'Episode templates' }}
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
