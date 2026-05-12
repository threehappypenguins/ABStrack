import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import type { HealthMarkerPresetRow, SymptomPresetRow } from '@abstrack/types';
import {
  validateEpisodeTemplateName,
  validateEpisodeTemplatePresetPair,
} from '@abstrack/types';
import { useMobileAuthUserId } from '../../lib/auth/use-mobile-auth-user-id';
import { useMobilePhiSubjectUserContext } from '../../lib/auth/use-mobile-phi-subject-user-context';
import {
  powerSyncOfflineReplicaReadsEnabled,
  powerSyncReplicaSqliteReady,
  usePowerSyncBridgeState,
} from '../../lib/powersync/PowerSyncSessionBridge';
import { resolveMobilePhiSubjectUserContext } from '../../lib/phi-subject/resolve-mobile-phi-subject-user-context';
import { saveNewEpisodeTemplate } from '../../lib/episode-templates/episode-template-service';
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
  const viewerUserId = useMobileAuthUserId();
  const viewerUserIdRef = useRef(viewerUserId);
  viewerUserIdRef.current = viewerUserId;

  const {
    phiSubjectUserId,
    loading: phiSubjectContextLoading,
    errorMessage: phiSubjectContextError,
  } = useMobilePhiSubjectUserContext();
  const phiSubjectUserIdRef = useRef<string | null>(null);
  const phiLoadingRef = useRef(false);
  const phiErrorRef = useRef<string | null>(null);
  phiSubjectUserIdRef.current = phiSubjectUserId;
  phiLoadingRef.current = phiSubjectContextLoading;
  phiErrorRef.current = phiSubjectContextError;

  /** Dedupes preset-list loads when only `listsLoading` / `listsError` churn after a successful fetch. */
  const lastPresetFetchKeyRef = useRef<string | null>(null);

  const psBridge = usePowerSyncBridgeState();
  const replicaMirrorReads = powerSyncOfflineReplicaReadsEnabled(psBridge);

  /** Latest offline-read knobs for fetches without re-subscribing when PowerSync opens. */
  const offlineReadRef = useRef({
    database: psBridge.database,
    replicationReady: replicaMirrorReads,
  });
  offlineReadRef.current = {
    database: psBridge.database,
    replicationReady: replicaMirrorReads,
  };

  /**
   * One automatic retry when lists failed but the mirror later becomes readable; reset when the
   * error clears or the replica drops so another offline→online cycle can retry again.
   */
  const presetListsAutoRetryConsumedRef = useRef(false);

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

  /** `undefined` until the first committed hook user id (detect real account switches vs hydration). */
  const prevViewerUserIdRef = useRef<string | null | undefined>(undefined);

  const loadPresetLists = useCallback(async (signal?: AbortSignal) => {
    setListsLoading(true);
    setListsError(null);
    const offlineRead = offlineReadRef.current;
    const [sRes, mRes] = await Promise.all([
      fetchSymptomPresets({
        powerSyncOfflineRead: offlineRead,
        scopeUserId: phiSubjectUserIdRef.current,
      }),
      fetchHealthMarkerPresets({
        powerSyncOfflineRead: offlineRead,
        scopeUserId: phiSubjectUserIdRef.current,
      }),
    ]);
    if (signal?.aborted) {
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
    const sList = sRes.data.map((r: SymptomPresetRow) => ({
      id: r.id,
      name: r.name,
    }));
    const mList = mRes.data.map((r: HealthMarkerPresetRow) => ({
      id: r.id,
      name: r.name,
    }));
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
    lastPresetFetchKeyRef.current = `${viewerUserIdRef.current ?? ''}|${phiSubjectUserIdRef.current ?? ''}|${phiLoadingRef.current ? 'L' : '-'}|${phiErrorRef.current ?? ''}`;
    setListsLoading(false);
  }, []);

  const loadPresetListsRef = useRef(loadPresetLists);
  loadPresetListsRef.current = loadPresetLists;

  /**
   * Loads preset picklists when the signed-in user id **or PHI scope** changes — not only on mount
   * — so an account switch cannot leave the previous user's symptom/marker names visible, and a
   * caretaker gets patient-scoped replica lists once {@link useMobilePhiSubjectUserContext} resolves.
   * Still intentionally independent of `replicaMirrorReads` (see retry effect below).
   *
   * `useMobileAuthUserId` starts as `null` and resolves asynchronously; `null → userId` is
   * hydration, not a switch — do not clear the form or refetch when preset lists already loaded
   * successfully (a second fetch would reset `loadPresetLists` baseline and wipe typed input).
   */
  useEffect(() => {
    const next = viewerUserId;
    const prev = prevViewerUserIdRef.current;

    const presetFetchKey = `${next ?? ''}|${phiSubjectUserId ?? ''}|${phiSubjectContextLoading ? 'L' : '-'}|${phiSubjectContextError ?? ''}`;

    if (
      prev !== undefined &&
      prev === next &&
      lastPresetFetchKeyRef.current != null &&
      lastPresetFetchKeyRef.current === presetFetchKey
    ) {
      return;
    }

    const isAuthHydration =
      prev === null && typeof next === 'string' && next.trim() !== '';

    if (isAuthHydration && !listsLoading && listsError == null) {
      prevViewerUserIdRef.current = next;
      lastPresetFetchKeyRef.current = presetFetchKey;
      return;
    }

    const switchedAccount =
      prev !== undefined && prev !== next && !isAuthHydration;

    prevViewerUserIdRef.current = next;

    if (switchedAccount) {
      lastPresetFetchKeyRef.current = null;
      setName('');
      setSymptomId(null);
      setMarkerId(null);
      setSymptoms([]);
      setMarkers([]);
      setFormBaseline({
        name: '',
        symptomId: null,
        markerId: null,
      });
    }

    presetListsAutoRetryConsumedRef.current = false;
    setListsLoading(true);
    setListsError(null);

    const ac = new AbortController();
    void loadPresetListsRef.current(ac.signal);
    return () => {
      ac.abort();
    };
  }, [
    viewerUserId,
    listsLoading,
    listsError,
    phiSubjectUserId,
    phiSubjectContextLoading,
    phiSubjectContextError,
  ]);

  useEffect(() => {
    if (!listsError) {
      presetListsAutoRetryConsumedRef.current = false;
    }
  }, [listsError]);

  useEffect(() => {
    if (!replicaMirrorReads) {
      presetListsAutoRetryConsumedRef.current = false;
    }
  }, [replicaMirrorReads]);

  /**
   * Cold start: first fetch can fail before the replica is mirror-readable. Do not tie the mount
   * load to `powerSyncOfflineReplicaReadsEnabled` (that would reset lists and baseline whenever
   * PowerSync flips while the user is editing). When we still show a list error and the mirror is
   * ready, retry once per error/replica cycle (`presetListsAutoRetryConsumedRef`).
   */
  useEffect(() => {
    if (!listsError || !replicaMirrorReads || listsLoading) {
      return;
    }
    if (presetListsAutoRetryConsumedRef.current) {
      return;
    }
    presetListsAutoRetryConsumedRef.current = true;
    const ac = new AbortController();
    void loadPresetListsRef.current(ac.signal);
    return () => {
      ac.abort();
    };
  }, [replicaMirrorReads, listsError, listsLoading]);

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
      const phiRes = await resolveMobilePhiSubjectUserContext({
        powerSyncDatabase: powerSyncReplicaSqliteReady(psBridge)
          ? psBridge.database
          : null,
      });
      if (!phiRes.ok) {
        announce(phiRes.error.message);
        return;
      }
      if (phiRes.data == null) {
        announce('You need to be signed in to create a template.');
        return;
      }
      const result = await saveNewEpisodeTemplate({
        user_id: phiRes.data.phiSubjectUserId,
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
