import { useCallback, useEffect, useState } from 'react';
import { Alert } from 'react-native';
import type {
  PresetSymptomRow,
  SymptomPresetRow,
  SymptomResponseType,
} from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import {
  fetchPresetSymptoms,
  fetchSymptomPresetById,
  removePresetSymptom,
  saveNewPresetSymptom,
  savePresetSymptom,
  savePresetSymptomOrder,
  saveSymptomPresetName,
} from './symptom-preset-service';

export type SymptomPresetEditorPageStatus =
  | 'loading'
  | 'ready'
  | 'not_found'
  | 'error';

function computeNextSortOrder(lines: PresetSymptomRow[]): number {
  if (lines.length === 0) {
    return 0;
  }
  return Math.max(...lines.map((l) => l.sort_order)) + 1;
}

/**
 * Loads and mutates one symptom preset (header + lines): rename, add lines, reorder,
 * update response types and prompts, remove lines. Consumed by `SymptomPresetEditorScreen`.
 *
 * @param presetId - `symptom_presets.id` from navigation.
 * @returns Screen state, async handlers, and derived lock flags.
 */
export function useSymptomPresetEditor(presetId: string) {
  const [pageStatus, setPageStatus] =
    useState<SymptomPresetEditorPageStatus>('loading');
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
    setNameDraft(result.data.name);
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

  return {
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
  };
}
