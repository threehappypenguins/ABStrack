import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { HomeScreen } from '../screens/HomeScreen';
import { EpisodeTemplatesNavigator } from './EpisodeTemplatesNavigator';
import { HealthMarkerPresetsNavigator } from './HealthMarkerPresetsNavigator';
import { SymptomPresetsNavigator } from './SymptomPresetsNavigator';
import { useAppTheme } from '../theme/AppThemeContext';
import { EpisodeTemplatesDraftProvider } from './EpisodeTemplatesDraftContext';
import { EpisodeTemplatesLeavingGuardTabButton } from './EpisodeTemplatesLeavingGuardTabButton';
import type { MainStackParamList, MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Home tab lives under {@link MainStackParamList} `MainTabs`; opens stack `Settings`.
 * Invariant: tab navigator is always nested in that stack — missing parent is a programmer error.
 *
 * @param navigation - Home tab navigation object.
 */
function navigateFromHomeTabToSettings(
  navigation: BottomTabNavigationProp<MainTabParamList, 'Home'>,
) {
  const stackNavigation =
    navigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'MainTabNavigator: expected native stack parent (MainStack) to open Settings.',
    );
  }
  stackNavigation.navigate('Settings');
}

function navigateFromHomeTabToEpisodeStart(
  navigation: BottomTabNavigationProp<MainTabParamList, 'Home'>,
) {
  const stackNavigation =
    navigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'MainTabNavigator: expected native stack parent (MainStack) to open EpisodeStart.',
    );
  }
  stackNavigation.navigate('EpisodeStart');
}

type IonName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * @param name - Ionicons glyph name.
 * @returns Tab bar icon render function for React Navigation.
 */
function tabBarIonIcon(name: IonName) {
  return function TabBarIon({ color, size }: { color: string; size: number }) {
    return <Ionicons name={name} size={size} color={color} />;
  };
}

/**
 * Primary signed-in navigation: home plus preset entry points with a bottom tab bar sized for
 * comfortable touch targets.
 *
 * @returns Tab navigator element.
 */
export function MainTabNavigator() {
  const { colors } = useAppTheme();

  return (
    <EpisodeTemplatesDraftProvider>
      <Tab.Navigator
        screenOptions={({ route }) => ({
          headerShown: false,
          tabBarActiveTintColor: colors.primary,
          tabBarInactiveTintColor: colors.muted,
          tabBarLabelPosition: 'below-icon',
          tabBarShowLabel: true,
          tabBarStyle: {
            paddingTop: 4,
            paddingBottom: 6,
            minHeight: COMFORTABLE_TOUCH_TARGET_DP + 28,
            backgroundColor: colors.surface,
            borderTopColor: colors.border,
            borderTopWidth: StyleSheet.hairlineWidth,
          },
          tabBarItemStyle: {
            paddingVertical: 4,
          },
          tabBarButton: (props) => (
            <EpisodeTemplatesLeavingGuardTabButton
              {...props}
              targetRoute={route.name as keyof MainTabParamList}
            />
          ),
        })}
      >
        <Tab.Screen
          name="Home"
          options={{
            tabBarLabel: 'Home',
            tabBarAccessibilityLabel: 'Home',
            tabBarIcon: tabBarIonIcon('home-outline'),
          }}
        >
          {({ navigation }) => (
            <HomeScreen
              onGoToSettings={() => {
                navigateFromHomeTabToSettings(navigation);
              }}
              onStartEpisode={() => {
                navigateFromHomeTabToEpisodeStart(navigation);
              }}
            />
          )}
        </Tab.Screen>
        <Tab.Screen
          name="SymptomPresets"
          component={SymptomPresetsNavigator}
          options={{
            tabBarLabel: 'Symptoms',
            tabBarAccessibilityLabel: 'Symptom presets',
            tabBarIcon: tabBarIonIcon('medkit-outline'),
          }}
        />
        <Tab.Screen
          name="HealthMarkerPresets"
          component={HealthMarkerPresetsNavigator}
          options={{
            tabBarLabel: 'Markers',
            tabBarAccessibilityLabel: 'Health marker presets',
            tabBarIcon: tabBarIonIcon('pulse-outline'),
          }}
        />
        <Tab.Screen
          name="EpisodeTemplates"
          component={EpisodeTemplatesNavigator}
          options={{
            tabBarLabel: 'Templates',
            tabBarAccessibilityLabel: 'Episode templates',
            tabBarIcon: tabBarIonIcon('layers-outline'),
          }}
        />
      </Tab.Navigator>
    </EpisodeTemplatesDraftProvider>
  );
}
