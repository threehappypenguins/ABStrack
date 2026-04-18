import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import {
  validateEpisodeTemplateName,
  validateEpisodeTemplatePresetPair,
} from '@abstrack/types';
import {
  getCurrentUserId,
  saveNewEpisodeTemplate,
} from '../../lib/episode-templates/episode-template-service';
import { fetchHealthMarkerPresets } from '../../lib/health-marker-presets/health-marker-preset-service';
import { fetchSymptomPresets } from '../../lib/symptom-presets/symptom-preset-service';
import { PresetOptionSheetField } from '../components/episode-templates/PresetOptionSheetField';
import { useUnsavedChangesBeforeRemove } from '../hooks/useUnsavedChangesBeforeRemove';
import { useEpisodeTemplatesDraftRegistration } from '../navigation/EpisodeTemplatesDraftContext';
import type { EpisodeTemplatesStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type CreateNav = NativeStackNavigationProp<
  EpisodeTemplatesStackParamList,
  'EpisodeTemplateCreate'
>;

type PresetOption = { id: string; name: string };

/**
 * Create screen: template name plus symptom and health marker presets (picker opens an action sheet).
 * Header back, Cancel, and Android system back prompt before discarding unsaved input (like web).
 *
 * @returns Create episode template screen.
 */
export function EpisodeTemplateCreateScreen() {
  const navigation = useNavigation<CreateNav>();
  const { colors } = useAppTheme();
  const [name, setName] = useState('');
  const [symptomId, setSymptomId] = useState<string | null>(null);
  const [markerId, setMarkerId] = useState<string | null>(null);
  const [symptoms, setSymptoms] = useState<PresetOption[]>([]);
  const [markers, setMarkers] = useState<PresetOption[]>([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Matches initial field values so dirty detection works while preset lists are still loading. */
  const [formBaseline, setFormBaseline] = useState<{
    name: string;
    symptomId: string | null;
    markerId: string | null;
  }>({
    name: '',
    symptomId: null,
    markerId: null,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setListsLoading(true);
      setListsError(null);
      const [sRes, mRes] = await Promise.all([
        fetchSymptomPresets(),
        fetchHealthMarkerPresets(),
      ]);
      if (cancelled) {
        return;
      }
      if (!sRes.ok) {
        setListsError(sRes.error.message);
        setListsLoading(false);
        return;
      }
      if (!mRes.ok) {
        setListsError(mRes.error.message);
        setListsLoading(false);
        return;
      }
      const sList = sRes.data.map((r) => ({ id: r.id, name: r.name }));
      const mList = mRes.data.map((r) => ({ id: r.id, name: r.name }));
      const initSymptom = sList.length === 1 ? sList[0].id : null;
      const initMarker = mList.length === 1 ? mList[0].id : null;
      setSymptoms(sList);
      setMarkers(mList);
      setSymptomId(initSymptom);
      setMarkerId(initMarker);
      setFormBaseline({
        name: '',
        symptomId: initSymptom,
        markerId: initMarker,
      });
      setListsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const nameOk = useMemo(() => validateEpisodeTemplateName(name).ok, [name]);

  const isDirty = useMemo(
    () =>
      name.trim() !== formBaseline.name.trim() ||
      symptomId !== formBaseline.symptomId ||
      markerId !== formBaseline.markerId,
    [formBaseline, name, symptomId, markerId],
  );

  const goToTemplateList = useCallback(() => {
    navigation.navigate('EpisodeTemplateList');
  }, [navigation]);

  const { prepareLeaveWithoutConfirmation, requestCancelToList } =
    useUnsavedChangesBeforeRemove(isDirty, navigation, {
      busy,
      onNavigateToList: goToTemplateList,
    });

  useEpisodeTemplatesDraftRegistration(true, isDirty, busy, goToTemplateList);

  const canSave = useMemo(() => {
    if (listsLoading || listsError || busy) {
      return false;
    }
    if (!symptomId || !markerId) {
      return false;
    }
    return nameOk;
  }, [busy, listsError, listsLoading, markerId, nameOk, symptomId]);

  const onSave = async () => {
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
    setBusy(true);
    try {
      const authResult = await getCurrentUserId();
      if (!authResult.ok) {
        announce(authResult.error.message);
        return;
      }
      if (authResult.data === null) {
        announce('You need to be signed in to create a template.');
        return;
      }
      const result = await saveNewEpisodeTemplate({
        user_id: authResult.data,
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
      navigation.replace('EpisodeTemplateList');
    } finally {
      setBusy(false);
    }
  };

  const needsPresetSelection =
    !listsLoading &&
    !listsError &&
    (symptomId == null || markerId == null) &&
    symptoms.length > 0 &&
    markers.length > 0;

  return (
    <ScrollView
      className="flex-1"
      contentContainerStyle={{
        flexGrow: 1,
        padding: 16,
        paddingBottom: 24,
      }}
      keyboardShouldPersistTaps="handled"
    >
      <Text className={`text-base ${nw.textMuted}`} maxFontSizeMultiplier={2}>
        Choose a name you will recognize when impaired, then tap each row below
        to pick from a list (action sheet). Similar preset names do not link
        automatically — this template row stores the pairing.
      </Text>

      {listsLoading ? (
        <Text className={`mt-4 text-base ${nw.textMuted}`}>
          Loading your presets…
        </Text>
      ) : null}
      {listsError ? (
        <Text
          className={`mt-4 text-base ${nw.textError}`}
          accessibilityRole="alert"
          maxFontSizeMultiplier={2}
        >
          {listsError}
        </Text>
      ) : null}

      <View className="mt-6 gap-2">
        <Text
          accessibilityRole="text"
          className={`text-base font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Template name
        </Text>
        <TextInput
          value={name}
          onChangeText={setName}
          editable={!busy}
          placeholder='e.g. "ABS Episode"'
          placeholderTextColor={colors.inputPlaceholder}
          className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          autoCapitalize="sentences"
          autoCorrect
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
          disabled={busy || listsLoading}
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
          disabled={busy || listsLoading}
          hint="Pick which marker preset pairs with this template."
        />
      </View>

      {needsPresetSelection ? (
        <Text
          className={`mt-4 text-sm ${nw.textMuted}`}
          accessibilityRole="text"
          maxFontSizeMultiplier={2}
        >
          Select both a symptom preset and a health marker preset above, then
          save.
        </Text>
      ) : null}

      {!listsLoading && !listsError && symptomId && markerId && !name.trim() ? (
        <Text
          className={`mt-4 text-sm ${nw.textMuted}`}
          accessibilityRole="text"
          maxFontSizeMultiplier={2}
        >
          Enter a template name to enable save.
        </Text>
      ) : null}

      {!nameOk && name.trim().length > 0 ? (
        <Text
          className={`mt-2 text-sm ${nw.textError}`}
          accessibilityRole="alert"
          maxFontSizeMultiplier={2}
        >
          Fix the template name (cannot be empty; check length limits).
        </Text>
      ) : null}

      <View className="mt-8 gap-3">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Save episode template"
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
            {busy ? 'Saving…' : 'Save template'}
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
    </ScrollView>
  );
}
