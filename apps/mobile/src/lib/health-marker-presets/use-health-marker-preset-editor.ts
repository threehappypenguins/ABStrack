import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert } from 'react-native';
import type {
  HealthMarkerPresetRow,
  PresetHealthMarkerInsert,
  PresetHealthMarkerKind,
  PresetHealthMarkerRow,
  PresetHealthMarkerUpdate,
} from '@abstrack/types';
import { validatePresetHealthMarkerCustomFields } from '@abstrack/types';
import { announce } from '@abstrack/ui/native';
import {
  fetchHealthMarkerPresetById,
  fetchPresetHealthMarkers,
  removePresetHealthMarker,
  saveNewPresetHealthMarker,
  savePresetHealthMarker,
  savePresetHealthMarkerOrder,
  saveHealthMarkerPresetName,
} from './health-marker-preset-service';

export type HealthMarkerPresetEditorPageStatus =
  | 'loading'
  | 'ready'
  | 'not_found'
  | 'error';

function computeNextSortOrder(lines: PresetHealthMarkerRow[]): number {
  if (lines.length === 0) {
    return 0;
  }
  return Math.max(...lines.map((l) => l.sort_order)) + 1;
}

/**
 * Loads and mutates one health marker preset (header + lines): rename, add lines, reorder,
 * update marker kinds and custom fields, remove lines. Consumed by `HealthMarkerPresetEditorScreen`.
 *
 * @param presetId - `health_marker_presets.id` from navigation.
 * @returns Screen state, async handlers, and derived lock flags.
 */
export function useHealthMarkerPresetEditor(presetId: string) {
  const isMountedRef = useRef(true);
  const [pageStatus, setPageStatus] =
    useState<HealthMarkerPresetEditorPageStatus>('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [preset, setPreset] = useState<HealthMarkerPresetRow | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [nameDraft, setNameDraft] = useState('');

  const [newMarkerKind, setNewMarkerKind] =
    useState<PresetHealthMarkerKind>('blood_glucose');
  const [newCustomName, setNewCustomName] = useState('');
  const [newCustomUnit, setNewCustomUnit] = useState('');
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [linesSyncing, setLinesSyncing] = useState(false);
  const [pendingAction, setPendingAction] = useState(false);

  const refreshAll = useCallback(
    async (mode: 'full' | 'quiet' = 'full') => {
      if (mode === 'quiet') {
        const linesResult = await fetchPresetHealthMarkers(presetId);
        if (!isMountedRef.current) {
          return;
        }
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
        fetchHealthMarkerPresetById(presetId),
        fetchPresetHealthMarkers(presetId),
      ]);
      if (!isMountedRef.current) {
        return;
      }

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
      if (isMountedRef.current) {
        setLinesSyncing(false);
      }
    }
  }, [refreshAll]);

  useEffect(() => {
    isMountedRef.current = true;
    void refreshAll();
    return () => {
      isMountedRef.current = false;
    };
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
    const result = await saveHealthMarkerPresetName(preset.id, {
      name: trimmed,
    });
    if (!isMountedRef.current) {
      return;
    }
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

  const handleAddMarker = async () => {
    setAddFormError(null);
    const validation = validatePresetHealthMarkerCustomFields(
      newMarkerKind,
      newCustomName,
      newCustomUnit,
    );
    if (validation) {
      setAddFormError(validation);
      announce(validation);
      return;
    }
    setAdding(true);
    try {
      const sortOrder = computeNextSortOrder(lines);
      const row: PresetHealthMarkerInsert =
        newMarkerKind === 'custom'
          ? {
              preset_id: presetId,
              sort_order: sortOrder,
              marker_kind: 'custom',
              custom_name: newCustomName.trim(),
              custom_unit: newCustomUnit.trim(),
            }
          : {
              preset_id: presetId,
              sort_order: sortOrder,
              marker_kind: newMarkerKind,
              custom_name: null,
              custom_unit: null,
            };
      const result = await saveNewPresetHealthMarker(row);
      if (!isMountedRef.current) {
        return;
      }
      if (!result.ok) {
        announce(result.error.message);
        setAddFormError(result.error.message);
        return;
      }
      setNewMarkerKind('blood_glucose');
      setNewCustomName('');
      setNewCustomUnit('');
      await refreshQuiet();
      if (!isMountedRef.current) {
        return;
      }
      announce('Marker added to preset.');
    } finally {
      if (isMountedRef.current) {
        setAdding(false);
      }
    }
  };

  const handleMarkerKindChange = async (
    line: PresetHealthMarkerRow,
    next: PresetHealthMarkerKind,
  ) => {
    if (line.marker_kind === next) {
      return;
    }
    setPendingAction(true);
    const patch: PresetHealthMarkerUpdate =
      next === 'custom'
        ? { marker_kind: 'custom', custom_name: null, custom_unit: null }
        : { marker_kind: next, custom_name: null, custom_unit: null };
    const result = await savePresetHealthMarker(line.id, patch);
    if (!isMountedRef.current) {
      return;
    }
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Marker type updated.');
  };

  const handleCustomFieldsCommit = async (
    line: PresetHealthMarkerRow,
    nameDraft: string,
    unitDraft: string,
  ) => {
    if (line.marker_kind !== 'custom') {
      return;
    }
    const validation = validatePresetHealthMarkerCustomFields(
      'custom',
      nameDraft,
      unitDraft,
    );
    if (validation) {
      announce(validation);
      return;
    }
    const name = nameDraft.trim();
    const unit = unitDraft.trim();
    const prevName = line.custom_name?.trim() ?? '';
    const prevUnit = line.custom_unit?.trim() ?? '';
    if (name === prevName && unit === prevUnit) {
      return;
    }
    setPendingAction(true);
    const result = await savePresetHealthMarker(line.id, {
      custom_name: name,
      custom_unit: unit,
    });
    if (!isMountedRef.current) {
      return;
    }
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Custom marker details saved.');
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
    const result = await savePresetHealthMarkerOrder(presetId, orderedIds);
    if (!isMountedRef.current) {
      return;
    }
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message);
      await refreshQuiet();
      return;
    }
    await refreshQuiet();
    if (!isMountedRef.current) {
      return;
    }
    announce('Marker order updated.');
  };

  const confirmRemoveLine = (line: PresetHealthMarkerRow) => {
    Alert.alert(
      'Remove this marker?',
      'This line will be removed from the preset. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setPendingAction(true);
              const result = await removePresetHealthMarker(line.id);
              if (!isMountedRef.current) {
                return;
              }
              setPendingAction(false);
              if (!result.ok) {
                announce(result.error.message);
                return;
              }
              await refreshQuiet();
              if (!isMountedRef.current) {
                return;
              }
              announce('Marker removed from preset.');
            })();
          },
        },
      ],
    );
  };

  const lineControlsLocked = pendingAction || adding || linesSyncing;
  const addFormLocked = adding || linesSyncing;

  return {
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
  };
}
