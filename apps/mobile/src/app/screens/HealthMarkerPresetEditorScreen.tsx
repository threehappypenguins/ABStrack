import React from 'react';
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useHealthMarkerPresetEditor } from '../../lib/health-marker-presets/use-health-marker-preset-editor';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { HealthMarkerKindPicker } from '../components/health-marker-presets/HealthMarkerKindPicker';
import { HealthMarkerLineCard } from '../components/health-marker-presets/HealthMarkerLineCard';
import type { HealthMarkerPresetsStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type EditorRoute = RouteProp<
  HealthMarkerPresetsStackParamList,
  'HealthMarkerPresetEdit'
>;

/**
 * Edits one health marker preset: header name, add lines with kinds and custom fields, reorder.
 *
 * @returns Editor screen bound to route `presetId`.
 */
export function HealthMarkerPresetEditorScreen() {
  const navigation = useNavigation();
  const route = useRoute<EditorRoute>();
  const { presetId } = route.params;
  const { colors } = useAppTheme();

  const {
    pageStatus,
    loadError,
    preset,
    lines,
    nameDraft,
    setNameDraft,
    newMarkerKind,
    setNewMarkerKind,
    newCustomName,
    setNewCustomName,
    newCustomUnit,
    setNewCustomUnit,
    addFormError,
    setAddFormError,
    adding,
    linesSyncing,
    pendingAction,
    refreshAll,
    handleNameBlur,
    handleAddMarker,
    handleMarkerKindChange,
    handleCustomFieldsCommit,
    handleMove,
    confirmRemoveLine,
    lineControlsLocked,
    addFormLocked,
  } = useHealthMarkerPresetEditor(presetId);

  if (pageStatus === 'not_found') {
    return (
      <AsyncScreenContainer status="ready">
        <View className="flex-1 gap-4 px-4 py-6">
          <Text
            className={`text-xl font-semibold ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Preset not found
          </Text>
          <Text
            className={`text-base ${nw.textMuted}`}
            maxFontSizeMultiplier={2}
          >
            This preset may have been deleted or you may not have access.
          </Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Go back to health marker presets list"
            onPress={() => {
              navigation.goBack();
            }}
            className={`items-center justify-center rounded-[12px] px-4 py-3 ${nw.btnPrimary}`}
            style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          >
            <Text className={`text-[17px] font-semibold ${nw.textOnPrimary}`}>
              Back to list
            </Text>
          </Pressable>
        </View>
      </AsyncScreenContainer>
    );
  }

  return (
    <AsyncScreenContainer
      status={
        pageStatus === 'error'
          ? 'error'
          : pageStatus === 'loading'
            ? 'loading'
            : 'ready'
      }
      loadingAccessibilityLabel="Loading preset"
      errorMessage={loadError ?? undefined}
      onRetry={() => {
        void refreshAll();
      }}
    >
      {preset ? (
        <ScrollView
          className="flex-1"
          contentContainerStyle={{
            padding: 16,
            paddingBottom: 32,
          }}
          keyboardShouldPersistTaps="handled"
        >
          <View className="gap-2 pb-4">
            <Text
              className={`text-base ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              Name your preset, then add health markers in the order you want
              during an episode.
            </Text>
            <Text
              className={`text-base font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Preset name
            </Text>
            <TextInput
              value={nameDraft}
              editable={!pendingAction}
              onChangeText={setNameDraft}
              onBlur={() => {
                void handleNameBlur();
              }}
              className={`rounded-[10px] px-3 py-3 text-[18px] font-semibold ${nw.input}`}
              style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
              maxFontSizeMultiplier={2}
              accessibilityLabel="Preset name"
            />
          </View>

          <View className={`mb-6 gap-3 rounded-xl p-4 ${nw.card}`}>
            <Text
              className={`text-lg font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Add a marker
            </Text>
            <Text
              className={`text-sm ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              Choose a measurement type. For custom markers, enter a name and
              unit below.
            </Text>

            <View className="gap-2">
              <Text
                className={`text-base font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Marker type
              </Text>
              <HealthMarkerKindPicker
                value={newMarkerKind}
                disabled={addFormLocked}
                onChange={(k) => {
                  setNewMarkerKind(k);
                  setAddFormError(null);
                }}
              />
            </View>

            {newMarkerKind === 'custom' ? (
              <View className="gap-3">
                <View className="gap-1">
                  <Text
                    className={`text-base font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Custom name
                  </Text>
                  <TextInput
                    value={newCustomName}
                    editable={!addFormLocked}
                    onChangeText={(t) => {
                      setNewCustomName(t);
                      setAddFormError(null);
                    }}
                    placeholder="e.g. Ketones"
                    placeholderTextColor={colors.inputPlaceholder}
                    className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    maxFontSizeMultiplier={2}
                    accessibilityLabel="New custom marker name"
                  />
                </View>
                <View className="gap-1">
                  <Text
                    className={`text-base font-semibold ${nw.textInk}`}
                    maxFontSizeMultiplier={2}
                  >
                    Unit
                  </Text>
                  <TextInput
                    value={newCustomUnit}
                    editable={!addFormLocked}
                    onChangeText={(t) => {
                      setNewCustomUnit(t);
                      setAddFormError(null);
                    }}
                    placeholder="e.g. mmol/L"
                    placeholderTextColor={colors.inputPlaceholder}
                    className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
                    style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                    maxFontSizeMultiplier={2}
                    accessibilityLabel="New custom marker unit"
                  />
                </View>
              </View>
            ) : null}

            {addFormError ? (
              <Text
                accessibilityRole="alert"
                className={`text-sm text-red-700 dark:text-red-300`}
                maxFontSizeMultiplier={2}
              >
                {addFormError}
              </Text>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add marker to preset"
              disabled={addFormLocked || pendingAction}
              onPress={() => {
                void handleAddMarker();
              }}
              className={`items-center justify-center rounded-[12px] px-4 py-3 active:opacity-90 ${nw.btnPrimary}`}
              style={{
                minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                opacity: addFormLocked || pendingAction ? 0.55 : 1,
              }}
            >
              <Text
                className={`text-[17px] font-semibold ${nw.textOnPrimary}`}
                maxFontSizeMultiplier={2}
              >
                {adding
                  ? 'Adding…'
                  : linesSyncing
                    ? 'Updating…'
                    : 'Add to preset'}
              </Text>
            </Pressable>
          </View>

          <View className="gap-3">
            <Text
              className={`text-lg font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Markers in order
            </Text>
            <Text
              className={`text-sm ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              The app will prompt for each marker in this order during an
              episode.
            </Text>

            {linesSyncing ? (
              <Text
                className={`text-sm ${nw.textMuted}`}
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={2}
              >
                Updating marker list…
              </Text>
            ) : null}

            {lines.length === 0 ? (
              <View
                className={`rounded-xl border border-dashed p-4 ${nw.card}`}
              >
                <Text
                  className={`text-base ${nw.textMuted}`}
                  maxFontSizeMultiplier={2}
                >
                  No markers yet. Add at least one using the form above.
                </Text>
              </View>
            ) : (
              <View className="gap-4">
                {lines.map((line, index) => (
                  <HealthMarkerLineCard
                    key={line.id}
                    line={line}
                    index={index}
                    total={lines.length}
                    disabled={lineControlsLocked}
                    onMove={(dir) => {
                      void handleMove(index, dir);
                    }}
                    onRequestRemove={() => {
                      confirmRemoveLine(line);
                    }}
                    onMarkerKindChange={(l, next) => {
                      void handleMarkerKindChange(l, next);
                    }}
                    onCustomFieldsCommit={(l, n, u) => {
                      void handleCustomFieldsCommit(l, n, u);
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : null}
    </AsyncScreenContainer>
  );
}
