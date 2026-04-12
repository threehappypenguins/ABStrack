import React from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import { ALL_ABS_SYMPTOM_SUGGESTIONS } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { useSymptomPresetEditor } from '../../lib/symptom-presets/use-symptom-preset-editor';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import { SymptomLineCard } from '../components/symptom-presets/SymptomLineCard';
import { SymptomResponseTypePicker } from '../components/symptom-presets/SymptomResponseTypePicker';
import type { SymptomPresetsStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

type EditorRoute = RouteProp<SymptomPresetsStackParamList, 'SymptomPresetEdit'>;

/**
 * Edits one symptom preset: header name, add lines with suggestions and response types, reorder lines.
 *
 * @returns Editor screen bound to route `presetId`.
 */
export function SymptomPresetEditorScreen() {
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
    newSymptomName,
    setNewSymptomName,
    newResponseType,
    setNewResponseType,
    adding,
    linesSyncing,
    pendingAction,
    suggestionsOpen,
    setSuggestionsOpen,
    refreshAll,
    handleNameBlur,
    handleAddSymptom,
    handleResponseTypeChange,
    handleSymptomNameCommit,
    handlePromptCommit,
    handleMove,
    confirmRemoveLine,
    lineControlsLocked,
    addFormLocked,
  } = useSymptomPresetEditor(presetId);

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
            accessibilityLabel="Go back to symptom presets list"
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
              Name your preset, then add symptoms in the order you want them
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
              Add a symptom
            </Text>
            <Text
              className={`text-sm ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              Pick a common ABS symptom from suggestions or type your own.
              Choose how each symptom should be captured when you log an
              episode.
            </Text>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Browse common ABS symptom suggestions"
              disabled={addFormLocked}
              onPress={() => {
                setSuggestionsOpen(true);
              }}
              className={`items-center justify-center rounded-[10px] border px-3 py-3 active:opacity-90 ${nw.btnSecondary}`}
              style={{
                minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                opacity: addFormLocked ? 0.55 : 1,
              }}
            >
              <Text
                className={`text-center text-[16px] font-semibold ${nw.textPrimary}`}
                maxFontSizeMultiplier={2}
              >
                Browse common ABS symptom suggestions
              </Text>
            </Pressable>

            <View className="gap-1">
              <Text
                className={`text-base font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Symptom name
              </Text>
              <TextInput
                value={newSymptomName}
                editable={!addFormLocked}
                onChangeText={setNewSymptomName}
                placeholder="Type a symptom"
                placeholderTextColor={colors.inputPlaceholder}
                className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
                autoCapitalize="sentences"
                maxFontSizeMultiplier={2}
                accessibilityLabel="New symptom name"
              />
            </View>

            <View className="gap-2">
              <Text
                className={`text-base font-semibold ${nw.textInk}`}
                maxFontSizeMultiplier={2}
              >
                Response type
              </Text>
              <SymptomResponseTypePicker
                value={newResponseType}
                disabled={addFormLocked}
                onChange={setNewResponseType}
              />
            </View>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Add symptom to preset"
              disabled={addFormLocked || pendingAction}
              onPress={() => {
                void handleAddSymptom();
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
              Symptoms in order
            </Text>
            <Text
              className={`text-sm ${nw.textMuted}`}
              maxFontSizeMultiplier={2}
            >
              The app will prompt for each symptom in this order during an
              episode.
            </Text>

            {linesSyncing ? (
              <Text
                className={`text-sm ${nw.textMuted}`}
                accessibilityLiveRegion="polite"
                maxFontSizeMultiplier={2}
              >
                Updating symptom list…
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
                  No symptoms yet. Add at least one using the form above.
                </Text>
              </View>
            ) : (
              <View className="gap-4">
                {lines.map((line, index) => (
                  <SymptomLineCard
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
                    onResponseTypeChange={(next) => {
                      void handleResponseTypeChange(line, next);
                    }}
                    onNameCommit={(draft) => {
                      void handleSymptomNameCommit(line, draft);
                    }}
                    onPromptCommit={(draft) => {
                      void handlePromptCommit(line, draft);
                    }}
                  />
                ))}
              </View>
            )}
          </View>
        </ScrollView>
      ) : null}

      <Modal
        visible={suggestionsOpen}
        animationType="slide"
        onRequestClose={() => {
          setSuggestionsOpen(false);
        }}
        accessibilityViewIsModal
      >
        <SafeAreaView
          className={`flex-1 ${nw.screenBg}`}
          edges={['top', 'left', 'right', 'bottom']}
        >
          <View
            className="flex-row items-center justify-between border-b px-4 py-3"
            style={{
              borderColor: colors.border,
              minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            }}
          >
            <Text
              className={`flex-1 text-lg font-semibold ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              Pick a suggestion
            </Text>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close suggestions"
              onPress={() => {
                setSuggestionsOpen(false);
              }}
              hitSlop={12}
              style={{
                minWidth: COMFORTABLE_TOUCH_TARGET_DP,
                minHeight: COMFORTABLE_TOUCH_TARGET_DP,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Text className={`text-[17px] font-semibold ${nw.textPrimary}`}>
                Done
              </Text>
            </Pressable>
          </View>
          <ScrollView
            className="flex-1 px-4 pt-3"
            contentContainerStyle={{ paddingBottom: 32 }}
            keyboardShouldPersistTaps="handled"
          >
            {ALL_ABS_SYMPTOM_SUGGESTIONS.map((suggestion) => (
              <Pressable
                key={suggestion}
                accessibilityRole="button"
                accessibilityLabel={`Use suggestion ${suggestion}`}
                onPress={() => {
                  setNewSymptomName(suggestion);
                  announce(`Filled symptom name: ${suggestion}`);
                  setSuggestionsOpen(false);
                }}
                className={`mb-3 rounded-xl border px-4 py-4 active:opacity-90 ${nw.card}`}
                style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP + 8 }}
              >
                <Text
                  className={`text-[17px] ${nw.textInk}`}
                  maxFontSizeMultiplier={2}
                >
                  {suggestion}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </AsyncScreenContainer>
  );
}
