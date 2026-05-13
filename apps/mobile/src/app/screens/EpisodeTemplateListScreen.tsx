import React, { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, Text, View } from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { EpisodeTemplateWithPresetsRow } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useMobilePhiSubjectUserContext } from '../../lib/auth/use-mobile-phi-subject-user-context';
import {
  fetchEpisodeTemplates,
  getCurrentUserId,
  removeEpisodeTemplate,
} from '../../lib/episode-templates/episode-template-service';
import {
  powerSyncOfflineReplicaReadsEnabled,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import type { EpisodeTemplatesStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

/** Token for focus-scoped list loads. */
type FocusLoadCancel = { cancelled: boolean };

type ListNav = NativeStackNavigationProp<
  EpisodeTemplatesStackParamList,
  'EpisodeTemplateList'
>;

/**
 * Lists episode templates (named symptom + health marker pairings).
 *
 * @returns List screen for the Episode templates tab stack.
 */
export function EpisodeTemplateListScreen() {
  const navigation = useNavigation<ListNav>();
  const { colors } = useAppTheme();
  const {
    phiSubjectUserId,
    loading: phiSubjectContextLoading,
    errorMessage: phiSubjectContextError,
  } = useMobilePhiSubjectUserContext();
  const psBridge = usePowerSyncBridgeState();
  const replicaMirrorReads = powerSyncOfflineReplicaReadsEnabled(psBridge);
  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [rows, setRows] = useState<EpisodeTemplateWithPresetsRow[]>([]);

  const load = useCallback(
    async (focusCancel?: FocusLoadCancel) => {
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
          'You need to be signed in to manage episode templates.',
        );
        setStatus('error');
        return;
      }
      if (phiSubjectContextLoading) {
        return;
      }
      if (phiSubjectContextError) {
        setErrorMessage(phiSubjectContextError);
        setStatus('error');
        return;
      }
      const result = await fetchEpisodeTemplates({
        powerSyncOfflineRead: {
          database: psBridge.database,
          replicationReady: replicaMirrorReads,
        },
        scopeUserId: phiSubjectUserId,
      });
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
    },
    // Only re-run when offline template reads could change shape — not the whole bridge
    // (`syncConnecting` / `syncError` / first-sync flags would reset list state on every transition).
    [
      psBridge.database,
      replicaMirrorReads,
      phiSubjectUserId,
      phiSubjectContextLoading,
      phiSubjectContextError,
    ],
  );

  useFocusEffect(
    useCallback(() => {
      const focusCancel: FocusLoadCancel = { cancelled: false };
      void load(focusCancel);
      return () => {
        focusCancel.cancelled = true;
      };
    }, [load]),
  );

  const confirmDelete = (template: EpisodeTemplateWithPresetsRow) => {
    Alert.alert(
      'Delete this episode template?',
      `“${template.name}” will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              const result = await removeEpisodeTemplate(template.id);
              if (!result.ok) {
                announce(result.error.message);
                return;
              }
              announce('Episode template deleted.');
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
        testID="episode-template-list-screen"
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
          accessibilityLabel="Add episode template"
          onPress={() => {
            navigation.navigate('EpisodeTemplateCreate');
          }}
          className={`mb-4 items-center justify-center rounded-[12px] px-4 active:opacity-90 ${nw.btnPrimary}`}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
        >
          <Text
            className={`text-[17px] font-semibold ${nw.textOnPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Add template
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
              Episode templates pair one symptom preset with one health marker
              preset under a name you will recognize when impaired (for example
              “ABS Episode”). Create symptom and marker presets first, then add
              a template here.
            </Text>
          </View>
        ) : (
          <View className="gap-3" accessibilityRole="list">
            {rows.map((template) => (
              <View
                key={template.id}
                className={`flex-row items-stretch overflow-hidden rounded-xl ${nw.card}`}
                accessibilityRole="none"
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Edit template ${template.name}. Symptoms ${template.symptom_preset.name}, markers ${template.health_marker_preset.name}`}
                  onPress={() => {
                    navigation.navigate('EpisodeTemplateEdit', {
                      templateId: template.id,
                    });
                  }}
                  className="min-w-0 flex-1 px-4 py-3 active:opacity-90"
                  style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                >
                  <Text
                    className={`text-[17px] font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                    numberOfLines={2}
                  >
                    {template.name}
                  </Text>
                  <Text
                    className={`mt-1 text-sm ${nw.textMuted}`}
                    maxFontSizeMultiplier={2}
                    numberOfLines={3}
                  >
                    Symptoms: {template.symptom_preset.name} · Markers:{' '}
                    {template.health_marker_preset.name}
                  </Text>
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Delete template ${template.name}`}
                  onPress={() => {
                    confirmDelete(template);
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
