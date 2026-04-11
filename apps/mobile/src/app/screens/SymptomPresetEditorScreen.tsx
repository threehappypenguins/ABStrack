import React, { useCallback, useEffect, useState } from 'react';
import {
  Alert,
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
import { Ionicons } from '@expo/vector-icons';
import type {
  PresetSymptomRow,
  SymptomPresetRow,
  SymptomResponseType,
} from '@abstrack/types';
import { SYMPTOM_RESPONSE_TYPES } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import { COMFORTABLE_TOUCH_TARGET_DP } from '@abstrack/ui/native';
import { ALL_ABS_SYMPTOM_SUGGESTIONS } from '../../lib/symptom-presets/abs-symptom-suggestions';
import { getSymptomResponseTypeLabel } from '../../lib/symptom-presets/response-type-labels';
import {
  fetchPresetSymptoms,
  fetchSymptomPresetById,
  removePresetSymptom,
  saveNewPresetSymptom,
  savePresetSymptom,
  savePresetSymptomOrder,
  saveSymptomPresetName,
} from '../../lib/symptom-presets/symptom-preset-service';
import { AsyncScreenContainer } from '../components/AsyncScreenContainer';
import type { SymptomPresetsStackParamList } from '../navigation/types';
import { useAppTheme } from '../theme/AppThemeContext';
import { nw } from '../theme/app-nativewind-classes';

function computeNextSortOrder(lines: PresetSymptomRow[]): number {
  if (lines.length === 0) {
    return 0;
  }
  return Math.max(...lines.map((l) => l.sort_order)) + 1;
}

type EditorRoute = RouteProp<SymptomPresetsStackParamList, 'SymptomPresetEdit'>;

type ResponseTypePickerProps = {
  value: SymptomResponseType;
  onChange: (next: SymptomResponseType) => void;
  disabled: boolean;
};

/**
 * Large touch targets for each response type; behaves like a radio group.
 */
function SymptomResponseTypePicker({
  value,
  onChange,
  disabled,
}: ResponseTypePickerProps) {
  const { colors } = useAppTheme();

  return (
    <View
      accessibilityRole="radiogroup"
      accessibilityLabel="Response type"
      className="gap-2"
    >
      {SYMPTOM_RESPONSE_TYPES.map((t) => {
        const selected = value === t;
        return (
          <Pressable
            key={t}
            accessibilityRole="radio"
            accessibilityState={{ checked: selected }}
            accessibilityLabel={getSymptomResponseTypeLabel(t)}
            disabled={disabled}
            onPress={() => {
              onChange(t);
            }}
            className={`flex-row items-center justify-between rounded-[10px] px-3 py-3 active:opacity-90 ${nw.card}`}
            style={{
              minHeight: COMFORTABLE_TOUCH_TARGET_DP,
              borderWidth: selected ? 2 : 1,
              borderColor: selected ? colors.primary : colors.border,
            }}
          >
            <Text
              className={`flex-1 text-[16px] ${nw.textInk}`}
              maxFontSizeMultiplier={2}
            >
              {getSymptomResponseTypeLabel(t)}
            </Text>
            {selected ? (
              <Ionicons
                name="checkmark-circle"
                size={22}
                color={colors.primary}
              />
            ) : null}
          </Pressable>
        );
      })}
    </View>
  );
}

type SymptomLineCardProps = {
  line: PresetSymptomRow;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRequestRemove: () => void;
  onResponseTypeChange: (next: SymptomResponseType) => void;
  onNameCommit: (draft: string) => void;
  onPromptCommit: (draft: string | null) => void;
};

/**
 * One reorderable symptom row: name, response type, optional media instruction, move/remove.
 */
function SymptomLineCard({
  line,
  index,
  total,
  disabled,
  onMove,
  onRequestRemove,
  onResponseTypeChange,
  onNameCommit,
  onPromptCommit,
}: SymptomLineCardProps) {
  const { colors } = useAppTheme();
  const [nameDraft, setNameDraft] = useState(line.symptom_name);
  const [promptDraft, setPromptDraft] = useState(line.prompt_instruction ?? '');

  useEffect(() => {
    setNameDraft(line.symptom_name);
  }, [line.symptom_name]);

  useEffect(() => {
    setPromptDraft(line.prompt_instruction ?? '');
  }, [line.prompt_instruction]);

  const pos = index + 1;
  const showMediaPrompt =
    line.response_type === 'photo' || line.response_type === 'video';

  return (
    <View
      className={`gap-3 rounded-xl p-4 ${nw.card}`}
      accessibilityRole="none"
    >
      <Text
        className={`text-sm font-semibold ${nw.textMuted}`}
        maxFontSizeMultiplier={2}
      >
        Symptom {pos} of {total}
      </Text>

      <View className="gap-1">
        <Text
          className={`text-base font-semibold ${nw.textInk}`}
          maxFontSizeMultiplier={2}
        >
          Symptom name
        </Text>
        <TextInput
          value={nameDraft}
          editable={!disabled}
          onChangeText={setNameDraft}
          onBlur={() => {
            onNameCommit(nameDraft);
          }}
          className={`rounded-[10px] px-3 py-3 text-[17px] ${nw.input}`}
          style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
          maxFontSizeMultiplier={2}
          accessibilityLabel={`Symptom ${pos} name`}
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
          value={line.response_type}
          disabled={disabled}
          onChange={onResponseTypeChange}
        />
      </View>

      {showMediaPrompt ? (
        <View className="gap-1">
          <Text
            className={`text-base font-semibold ${nw.textInk}`}
            maxFontSizeMultiplier={2}
          >
            Instruction during photo or video (optional)
          </Text>
          <Text className={`text-sm ${nw.textMuted}`} maxFontSizeMultiplier={2}>
            Shown when the episode flow asks for this photo or video.
          </Text>
          <TextInput
            value={promptDraft}
            editable={!disabled}
            onChangeText={setPromptDraft}
            onBlur={() => {
              onPromptCommit(promptDraft);
            }}
            placeholder='e.g. "Say: The early bird catches the worm"'
            placeholderTextColor={colors.inputPlaceholder}
            multiline
            className={`rounded-[10px] px-3 py-3 text-[16px] ${nw.input}`}
            maxFontSizeMultiplier={2}
            accessibilityLabel={`Symptom ${pos} capture instruction`}
          />
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-2">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move symptom ${pos} up`}
          disabled={disabled || index === 0}
          onPress={() => {
            onMove(-1);
          }}
          className={`flex-1 items-center justify-center rounded-[10px] border px-2 py-3 active:opacity-90 ${nw.btnSecondary}`}
          style={{
            minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            minWidth: 120,
            opacity: disabled || index === 0 ? 0.45 : 1,
          }}
        >
          <Text
            className={`text-center text-[16px] font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Move up
          </Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Move symptom ${pos} down`}
          disabled={disabled || index >= total - 1}
          onPress={() => {
            onMove(1);
          }}
          className={`flex-1 items-center justify-center rounded-[10px] border px-2 py-3 active:opacity-90 ${nw.btnSecondary}`}
          style={{
            minHeight: COMFORTABLE_TOUCH_TARGET_DP,
            minWidth: 120,
            opacity: disabled || index >= total - 1 ? 0.45 : 1,
          }}
        >
          <Text
            className={`text-center text-[16px] font-semibold ${nw.textPrimary}`}
            maxFontSizeMultiplier={2}
          >
            Move down
          </Text>
        </Pressable>
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Remove symptom ${line.symptom_name}`}
        disabled={disabled}
        onPress={onRequestRemove}
        className="items-center justify-center rounded-[10px] border border-red-300 bg-red-50 px-3 py-3 active:opacity-90 dark:border-red-800 dark:bg-red-950/40"
        style={{ minHeight: COMFORTABLE_TOUCH_TARGET_DP }}
      >
        <Text
          className="text-[16px] font-semibold text-red-800 dark:text-red-200"
          maxFontSizeMultiplier={2}
        >
          Remove symptom
        </Text>
      </Pressable>
    </View>
  );
}

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

  const [pageStatus, setPageStatus] = useState<
    'loading' | 'ready' | 'not_found' | 'error'
  >('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<SymptomPresetRow | null>(null);
  const [lines, setLines] = useState<PresetSymptomRow[]>([]);
  const [nameDraft, setNameDraft] = useState('');

  const [newSymptomName, setNewSymptomName] = useState('');
  const [newResponseType, setNewResponseType] =
    useState<SymptomResponseType>('yes_no');
  const [adding, setAdding] = useState(false);
  const [linesSyncing, setLinesSyncing] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);
  const [suggestionsOpen, setSuggestionsOpen] = useState(false);

  const refreshAll = useCallback(
    async (mode: 'full' | 'quiet' = 'full') => {
      if (mode === 'quiet') {
        const linesResult = await fetchPresetSymptoms(presetId);
        if (!linesResult.ok) {
          setPageStatus('error');
          setLoadError(linesResult.error.message);
          return;
        }
        setLines(linesResult.data);
        return;
      }

      setPageStatus('loading');
      const [presetResult, linesResult] = await Promise.all([
        fetchSymptomPresetById(presetId),
        fetchPresetSymptoms(presetId),
      ]);

      if (!presetResult.ok) {
        setPageStatus('error');
        setLoadError(presetResult.error.message);
        return;
      }
      if (!presetResult.data) {
        setPageStatus('not_found');
        return;
      }
      if (!linesResult.ok) {
        setPageStatus('error');
        setLoadError(linesResult.error.message);
        return;
      }

      setPreset(presetResult.data);
      setNameDraft(presetResult.data.name);
      setLines(linesResult.data);
      setPageStatus('ready');
    },
    [presetId],
  );

  const refreshQuiet = useCallback(async () => {
    setLinesSyncing(true);
    try {
      await refreshAll('quiet');
    } finally {
      setLinesSyncing(false);
    }
  }, [refreshAll]);

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const handleNameBlur = async () => {
    if (!preset) {
      return;
    }
    const trimmed = nameDraft.trim();
    if (!trimmed || trimmed === preset.name) {
      setNameDraft(preset.name);
      return;
    }
    setPendingAction(true);
    const result = await saveSymptomPresetName(preset.id, { name: trimmed });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      setNameDraft(preset.name);
      return;
    }
    setPreset(result.data);
    announce('Preset name saved.');
  };

  const handleAddSymptom = async () => {
    const trimmed = newSymptomName.trim();
    if (!trimmed) {
      announce('Enter a symptom name or pick a suggestion.');
      return;
    }
    setAdding(true);
    try {
      const sortOrder = computeNextSortOrder(lines);
      const result = await saveNewPresetSymptom({
        preset_id: presetId,
        sort_order: sortOrder,
        symptom_name: trimmed,
        response_type: newResponseType,
      });
      if (!result.ok) {
        announce(result.error.message);
        return;
      }
      setNewSymptomName('');
      setNewResponseType('yes_no');
      await refreshQuiet();
      announce('Symptom added to preset.');
    } finally {
      setAdding(false);
    }
  };

  const handleResponseTypeChange = async (
    line: PresetSymptomRow,
    next: SymptomResponseType,
  ) => {
    if (line.response_type === next) {
      return;
    }
    setPendingAction(true);
    const result = await savePresetSymptom(line.id, { response_type: next });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Response type updated.');
  };

  const handleSymptomNameCommit = async (
    line: PresetSymptomRow,
    draft: string,
  ) => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === line.symptom_name) {
      return;
    }
    setPendingAction(true);
    const result = await savePresetSymptom(line.id, { symptom_name: trimmed });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Symptom name saved.');
  };

  const handlePromptCommit = async (
    line: PresetSymptomRow,
    draft: string | null,
  ) => {
    const nextVal = draft?.trim() || null;
    const prevVal = line.prompt_instruction?.trim() || null;
    if (nextVal === prevVal) {
      return;
    }
    setPendingAction(true);
    const result = await savePresetSymptom(line.id, {
      prompt_instruction: nextVal,
    });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Instruction saved.');
  };

  const handleMove = async (index: number, direction: -1 | 1) => {
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= lines.length) {
      return;
    }
    const orderedIds = lines.map((l) => l.id);
    const [moved] = orderedIds.splice(index, 1);
    orderedIds.splice(nextIndex, 0, moved);
    setPendingAction(true);
    const result = await savePresetSymptomOrder(presetId, orderedIds);
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    await refreshQuiet();
    announce('Symptom order updated.');
  };

  const confirmRemoveLine = (line: PresetSymptomRow) => {
    Alert.alert(
      'Remove this symptom?',
      `“${line.symptom_name}” will be removed from this preset. This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPendingAction(true);
              const result = await removePresetSymptom(line.id);
              setPendingAction(false);
              if (!result.ok) {
                announce(result.error.message);
                return;
              }
              await refreshQuiet();
              announce('Symptom removed from preset.');
            })();
          },
        },
      ],
    );
  };

  const lineControlsLocked =
    pendingAction || adding || linesSyncing || suggestionsOpen;
  const addFormLocked = adding || linesSyncing || suggestionsOpen;

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
          edges={['top', 'left', 'right']}
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
