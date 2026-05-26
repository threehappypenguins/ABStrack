import React from 'react';
import { StyleSheet } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import type { BottomTabNavigationProp } from '@react-navigation/bottom-tabs';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import type { ActiveEpisodeHomeSummary } from '../components/episode-flow/EpisodeStartHomeCta';
import { AppSecondaryMenuButton } from '../components/AppSecondaryMenuButton';
import { HomeScreen } from '../screens/HomeScreen';
import { InsightsScreen } from '../screens/InsightsScreen';
import { EpisodeTemplatesNavigator } from './EpisodeTemplatesNavigator';
import { HealthMarkerPresetsNavigator } from './HealthMarkerPresetsNavigator';
import { SymptomPresetsNavigator } from './SymptomPresetsNavigator';
import { useAppTheme } from '../theme/AppThemeContext';
import { EpisodeTemplatesDraftProvider } from './EpisodeTemplatesDraftContext';
import { EpisodeTemplatesLeavingGuardTabButton } from './EpisodeTemplatesLeavingGuardTabButton';
import type { MainStackParamList, MainTabParamList } from './types';

const Tab = createBottomTabNavigator<MainTabParamList>();

/**
 * Bottom tabs live under {@link MainStackParamList} `MainTabs`; stack screens such as `Manage` and
 * `Settings` are opened from tab roots via the parent native stack.
 * Invariant: tab navigator is always nested in that stack — missing parent is a programmer error.
 *
 * @param navigation - Any main-tab navigation object.
 */
function navigateFromTabToSettings(
  navigation: BottomTabNavigationProp<MainTabParamList>,
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

function navigateFromTabToManage(
  navigation: BottomTabNavigationProp<MainTabParamList>,
  params?: MainStackParamList['Manage'],
) {
  const stackNavigation =
    navigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'MainTabNavigator: expected native stack parent (MainStack) to open Manage.',
    );
  }
  stackNavigation.navigate('Manage', params);
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

function navigateFromHomeTabToEpisodeResume(
  navigation: BottomTabNavigationProp<MainTabParamList, 'Home'>,
  episode: ActiveEpisodeHomeSummary,
) {
  const stackNavigation =
    navigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'MainTabNavigator: expected native stack parent (MainStack) to open episode resume flow.',
    );
  }
  if (episode.resumeAtHealthMarkers) {
    stackNavigation.navigate('HealthMarkerPrompt', {
      episodeId: episode.episodeId,
      resume: true,
      hub: true,
    });
    return;
  }
  if (!episode.symptomPresetId) {
    throw new Error(
      'MainTabNavigator: expected symptom preset id for symptom resume.',
    );
  }
  stackNavigation.navigate('SymptomPrompt', {
    episodeId: episode.episodeId,
    symptomPresetId: episode.symptomPresetId,
    resume: true,
  });
}

function navigateFromHomeTabToFoodDiary(
  navigation: BottomTabNavigationProp<MainTabParamList, 'Home'>,
) {
  const stackNavigation =
    navigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'MainTabNavigator: expected native stack parent (MainStack) to open FoodDiaryEntry.',
    );
  }
  stackNavigation.navigate('FoodDiaryEntry', {});
}

function navigateFromHomeTabToStandaloneHealthMarkers(
  navigation: BottomTabNavigationProp<MainTabParamList, 'Home'>,
) {
  const stackNavigation =
    navigation.getParent<NativeStackNavigationProp<MainStackParamList>>();
  if (stackNavigation == null) {
    throw new Error(
      'MainTabNavigator: expected native stack parent (MainStack) to open StandaloneHealthMarkers.',
    );
  }
  stackNavigation.navigate('StandaloneHealthMarkers');
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
 * Home tab screen: stable `component` entry so hooks inside `HomeScreen` are not tied to a
 * render-prop `Tab.Screen` child function (avoids remount / hook-order surprises with navigation).
 *
 * @returns Home tab UI.
 */
function HomeTab() {
  const navigation =
    useNavigation<BottomTabNavigationProp<MainTabParamList, 'Home'>>();
  return (
    <HomeScreen
      headerAction={
        <AppSecondaryMenuButton
          onGoToManage={() => {
            navigateFromTabToManage(navigation);
          }}
          onGoToSettings={() => {
            navigateFromTabToSettings(navigation);
          }}
        />
      }
      onGoToManageEpisodes={() => {
        navigateFromTabToManage(navigation, { initialSegment: 'episodes' });
      }}
      onGoToFoodDiary={() => {
        navigateFromHomeTabToFoodDiary(navigation);
      }}
      onGoToStandaloneHealthMarkers={() => {
        navigateFromHomeTabToStandaloneHealthMarkers(navigation);
      }}
      onStartEpisode={() => {
        navigateFromHomeTabToEpisodeStart(navigation);
      }}
      onResumeEpisode={(episode) => {
        navigateFromHomeTabToEpisodeResume(navigation, episode);
      }}
    />
  );
}

/**
 * Placeholder Insights tab until the mobile charting experience ships.
 *
 * @returns Insights tab UI.
 */
function InsightsTab() {
  const navigation =
    useNavigation<BottomTabNavigationProp<MainTabParamList, 'Insights'>>();
  return (
    <InsightsScreen
      headerAction={
        <AppSecondaryMenuButton
          onGoToManage={() => {
            navigateFromTabToManage(navigation);
          }}
          onGoToSettings={() => {
            navigateFromTabToSettings(navigation);
          }}
        />
      }
    />
  );
}

/**
 * Primary signed-in navigation: home plus preset entry points with a bottom tab bar sized for
 * comfortable touch targets.
 *
 * @returns Tab navigator element.
 */
export function MainTabNavigator() {
  const { colors } = useAppTheme();
  const { bottom } = useSafeAreaInsets();
  const tabBarBottomPadding = 6 + bottom;
  const tabBarMinHeight = COMFORTABLE_TOUCH_TARGET_DP + 28 + bottom;

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
            paddingBottom: tabBarBottomPadding,
            minHeight: tabBarMinHeight,
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
          component={HomeTab}
          options={{
            tabBarLabel: 'Home',
            tabBarAccessibilityLabel: 'Home',
            tabBarIcon: tabBarIonIcon('home-outline'),
          }}
        />
        <Tab.Screen
          name="Insights"
          component={InsightsTab}
          options={{
            tabBarLabel: 'Insights',
            tabBarAccessibilityLabel: 'Insights',
            tabBarIcon: tabBarIonIcon('stats-chart-outline'),
          }}
        />
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
