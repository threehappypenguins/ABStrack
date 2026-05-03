import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RouteProp } from '@react-navigation/native';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import type { EpisodeTemplateWithPresetsRow } from '@abstrack/types';
import {
  normalizeEpisodeTemplateName,
  validateEpisodeTemplateName,
  validateEpisodeTemplatePresetPair,
} from '@abstrack/types';
import {
  fetchEpisodeTemplateById,
  removeEpisodeTemplate,
  saveEpisodeTemplate,
} from '../../lib/episode-templates/episode-template-service';
import { fetchHealthMarkerPresets } from '../../lib/health-marker-presets/health-marker-preset-service';
import {
  powerSyncOfflineReplicaReadsEnabled,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { fetchSymptomPresets } from '../../lib/symptom-presets/symptom-preset-service';
import { PresetOptionSheetField } from '../components/episode-templates/PresetOptionSheetField';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { useUnsavedChangesBeforeRemove } from '../hooks/useUnsavedChangesBeforeRemove';
import { useEpisodeTemplatesDraftRegistration } from '../navigation/EpisodeTemplatesDraftContext';
import type { EpisodeTemplatesStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type EditorNav = NativeStackNavigationProp<
  EpisodeTemplatesStackParamList,
  'EpisodeTemplateEdit'
>;

type EditorRoute = RouteProp<
  EpisodeTemplatesStackParamList,
  'EpisodeTemplateEdit'
>;

type PresetOption = { id: string; name: string };

/**
 * Edit an episode template: name and/or linked presets. Back, Cancel, and Android back prompt
 * before discarding unsaved edits.
 *
 * @returns Edit screen bound to route `templateId`.
 */
export function EpisodeTemplateEditorScreen() {
  const route = useRoute<EditorRoute>();
  const { templateId } = route.params;
  const navigation = useNavigation<EditorNav>();
  const { colors } = useAppTheme();
  const psBridge = usePowerSyncBridgeState();

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [row, setRow] = useState<EpisodeTemplateWithPresetsRow | null>(null);
  const [name, setName] = useState('');
  const [symptomId, setSymptomId] = useState<string | null>(null);
  const [markerId, setMarkerId] = useState<string | null>(null);
  const [symptoms, setSymptoms] = useState<PresetOption[]>([]);
  const [markers, setMarkers] = useState<PresetOption[]>([]);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setStatus('loading');
    setErrorMessage(null);
    const offlineRead = {
      database: psBridge.database,
      replicationReady: powerSyncOfflineReplicaReadsEnabled(psBridge),
    };
    const [tRes, sRes, mRes] = await Promise.all([
      fetchEpisodeTemplateById(templateId, {
        powerSyncOfflineRead: offlineRead,
      }),
      fetchSymptomPresets({ powerSyncOfflineRead: offlineRead }),
      fetchHealthMarkerPresets({ powerSyncOfflineRead: offlineRead }),
    ]);
    if (!sRes.ok) {
      setErrorMessage(sRes.error.message);
      setStatus('error');
      return;
    }
    if (!mRes.ok) {
      setErrorMessage(mRes.error.message);
      setStatus('error');
      return;
    }
    setSymptoms(sRes.data.map((r) => ({ id: r.id, name: r.name })));
    setMarkers(mRes.data.map((r) => ({ id: r.id, name: r.name })));

    if (!tRes.ok) {
      setErrorMessage(tRes.error.message);
      setStatus('error');
      return;
    }
    if (!tRes.data) {
      setErrorMessage('We could not find that episode template.');
      setStatus('error');
      return;
    }
    const t = tRes.data;
    setRow(t);
    setName(normalizeEpisodeTemplateName(t.name));
    setSymptomId(t.symptom_preset_id);
    setMarkerId(t.health_marker_preset_id);
    setStatus('ready');
  }, [templateId, psBridge]);

  useEffect(() => {
    void load();
  }, [load]);

  const isDirty = useMemo(() => {
    if (!row) {
      return false;
    }
    const draftName = normalizeEpisodeTemplateName(name);
    const storedName = normalizeEpisodeTemplateName(row.name);
    return (
      draftName !== storedName ||
      symptomId !== row.symptom_preset_id ||
      markerId !== row.health_marker_preset_id
    );
  }, [row, name, symptomId, markerId]);

  const goToTemplateList = useCallback(() => {
    navigation.navigate('EpisodeTemplateList');
  }, [navigation]);

  const { prepareLeaveWithoutConfirmation, requestCancelToList } =
    useUnsavedChangesBeforeRemove(isDirty && status === 'ready', navigation, {
      busy,
      onNavigateToList: goToTemplateList,
    });

  useEpisodeTemplatesDraftRegistration(true, isDirty, busy, goToTemplateList);

  const nameValidation = useMemo(
    () => validateEpisodeTemplateName(name),
    [name],
  );

  const canSave = useMemo(() => {
    if (status !== 'ready' || !row || busy) {
      return false;
    }
    if (!isDirty) {
      return false;
    }
    if (!nameValidation.ok) {
      return false;
    }
    if (symptomId == null || markerId == null) {
      return false;
    }
    return true;
  }, [busy, isDirty, markerId, nameValidation.ok, row, status, symptomId]);

  const onSave = async () => {
    if (!row) {
      return;
    }
    const nameCheck = validateEpisodeTemplateName(name);
    if (!nameCheck.ok) {
      announce(nameCheck.message);
      return;
    }
    const pair = validateEpisodeTemplatePresetPair(
      symptomId ?? '',
      markerId ?? '',
    );
    if (!pair.ok) {
      announce(pair.message);
      return;
    }
    const sid = symptomId as string;
    const hid = markerId as string;
    const unchanged =
      nameCheck.name === normalizeEpisodeTemplateName(row.name) &&
      sid === row.symptom_preset_id &&
      hid === row.health_marker_preset_id;
    if (unchanged) {
      announce('No changes to save.');
      return;
    }
    setBusy(true);
    try {
      const result = await saveEpisodeTemplate(row.id, {
        name: nameCheck.name,
        symptom_preset_id: sid,
        health_marker_preset_id: hid,
      });
      if (!result.ok) {
        announce(result.error.message);
        return;
      }
      announce('Episode template saved.');
      prepareLeaveWithoutConfirmation();
      navigation.navigate('EpisodeTemplateList');
    } finally {
      setBusy(false);
    }
  };

  const confirmDelete = () => {
    if (!row) {
      return;
    }
    Alert.alert(
      'Delete this episode template?',
      `“${row.name}” will be removed. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setBusy(true);
              try {
                const result = await removeEpisodeTemplate(row.id);
                if (!result.ok) {
                  announce(result.error.message);
                  return;
                }
                announce('Episode template deleted.');
                prepareLeaveWithoutConfirmation();
                navigation.navigate('EpisodeTemplateList');
              } finally {
                setBusy(false);
              }
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
      {row ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            flexGrow: 1,
            padding: 16,
            paddingBottom: 24,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <Text
            className={`text-base ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            Update the name or tap a preset row to pick from a list. Save when
            you are done — you will return to the list after a successful save.
          </Text>

          <View className="mt-6 gap-2">
            <Text
              className={`text-base font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Template name
            </Text>
            <TextInput
              value={name}
              onChangeText={setName}
              editable={!busy}
              placeholderTextColor={colors.inputPlaceholder}
              className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              autoCapitalize="sentences"
              maxFontSizeMultiplier={2}
              accessibilityLabel="Episode template name"
            />
          </View>

          <View className="mt-8">
            <PresetOptionSheetField
              label="Symptom preset"
              placeholderLabel="Tap to choose a symptom preset…"
              options={symptoms}
              value={symptomId}
              onValueChange={setSymptomId}
              disabled={busy}
              hint="Opens a list from the bottom of the screen."
            />
          </View>

          <View className="mt-6">
            <PresetOptionSheetField
              label="Health marker preset"
              placeholderLabel="Tap to choose a health marker preset…"
              options={markers}
              value={markerId}
              onValueChange={setMarkerId}
              disabled={busy}
              hint="Pick which marker preset pairs with this template."
            />
          </View>

          {!isDirty ? (
            <Text
              className={`mt-4 text-sm ${nw.textMuted}`}
              accessibilityRole="text"
              maxFontSizeMultiplier={2}
            >
              Change something above to enable save, use Cancel to go back, or
              use Delete to remove this template.
            </Text>
          ) : null}

          {!nameValidation.ok && name.trim().length > 0 ? (
            <Text
              className={`mt-2 text-sm ${nw.textError}`}
              accessibilityRole="alert"
              maxFontSizeMultiplier={2}
            >
              {nameValidation.message}
            </Text>
          ) : null}

          <View className="mt-8 gap-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Save changes"
              accessibilityState={{ disabled: !canSave }}
              disabled={!canSave}
              onPress={() => void onSave()}
              className={`items-center justify-center rounded-[12px] px-4 active:opacity-90 ${nw.btnPrimary}`}
              style={{
                minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                opacity: canSave ? 1 : 0.45,
              }}
            >
              <Text
                className={`text-[17px] font-semibold ${nw.textOnPrimary}`}
                maxFontSizeMultiplier={2}
              >
                {busy ? 'Saving…' : 'Save changes'}
              </Text>
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Cancel without saving, return to episode templates"
              accessibilityHint="If you have unsaved changes, you will be asked to confirm."
              accessibilityState={{ disabled: busy }}
              disabled={busy}
              onPress={requestCancelToList}
              className={`items-center justify-center rounded-[12px] border px-4 active:opacity-90 ${nw.btnSecondary}`}
              style={{
                minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                opacity: busy ? 0.45 : 1,
              }}
            >
              <Text
                className={`text-[17px] font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Cancel
              </Text>
            </Pressable>
          </View>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Delete episode template"
            disabled={busy}
            onPress={confirmDelete}
            className="mt-4 items-center justify-center rounded-[12px] border border-red-300 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-950/40"
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          >
            <Text
              className="text-[17px] font-semibold text-red-800 dark:text-red-200"
              maxFontSizeMultiplier={2}
            >
              Delete template
            </Text>
          </Pressable>
        </ScrollView>
      ) : null}
    </AsyncScreenContainer>
  );
}
