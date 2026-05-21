'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import {
  PRESET_HEALTH_MARKER_KINDS,
  PRESET_HEALTH_MARKER_KIND_LABELS,
  validatePresetHealthMarkerCustomFields,
  type HealthMarkerPresetRow,
  type PresetHealthMarkerInsert,
  type PresetHealthMarkerKind,
  type PresetHealthMarkerRow,
  type PresetHealthMarkerUpdate,
} from '@abstrack/types';
import {
  createPresetHealthMarker,
  deleteHealthMarkerPreset,
  deletePresetHealthMarker,
  getHealthMarkerPresetById,
  listPresetHealthMarkersForPreset,
  reorderPresetHealthMarkers,
  updateHealthMarkerPreset,
  updatePresetHealthMarker,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';

export type HealthMarkerPresetEditorPageProps = {
  /** `health_marker_presets.id` from the route. */
  presetId: string;
};

function computeNextSortOrder(lines: PresetHealthMarkerRow[]): number {
  if (lines.length === 0) {
    return 0;
  }
  return Math.max(...lines.map((l) => l.sort_order)) + 1;
}

/**
 * Full editor for one health marker preset: rename header, add/reorder/edit/delete lines.
 *
 * @param props - Route param wiring.
 * @returns Editor UI.
 */
export function HealthMarkerPresetEditorPage({
  presetId,
}: HealthMarkerPresetEditorPageProps) {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();

  const [preset, setPreset] = useState<HealthMarkerPresetRow | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [pageStatus, setPageStatus] = useState<
    'loading' | 'ready' | 'not_found' | 'error'
  >('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newMarkerKind, setNewMarkerKind] =
    useState<PresetHealthMarkerKind>('blood_glucose');
  const [newCustomName, setNewCustomName] = useState('');
  const [newCustomUnit, setNewCustomUnit] = useState('');
  const [addFormError, setAddFormError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [linesSyncing, setLinesSyncing] = useState(false);

  const [pendingAction, setPendingAction] = useState(false);
  const [deletePresetOpen, setDeletePresetOpen] = useState(false);
  const [deleteLineTarget, setDeleteLineTarget] =
    useState<PresetHealthMarkerRow | null>(null);

  const refreshAll = useCallback(
    async (mode: 'full' | 'quiet' = 'full') => {
      const supabase = createBrowserClient();

      if (mode === 'quiet') {
        const linesResult = await listPresetHealthMarkersForPreset(
          supabase,
          presetId,
        );
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
        getHealthMarkerPresetById(supabase, presetId),
        listPresetHealthMarkersForPreset(supabase, presetId),
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
    if (authLoading || !session) {
      return;
    }
    void refreshAll();
  }, [authLoading, session, refreshAll]);

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
    const supabase = createBrowserClient();
    const result = await updateHealthMarkerPreset(supabase, preset.id, {
      name: trimmed,
    });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      setNameDraft(preset.name);
      return;
    }
    setPreset(result.data);
    announce('Preset name saved.', { politeness: 'polite' });
  };

  const handleAddMarker = async (e: React.FormEvent) => {
    e.preventDefault();
    setAddFormError(null);
    const validation = validatePresetHealthMarkerCustomFields(
      newMarkerKind,
      newCustomName,
      newCustomUnit,
    );
    if (validation) {
      setAddFormError(validation);
      announce(validation, { politeness: 'assertive' });
      return;
    }
    setAdding(true);
    try {
      const supabase = createBrowserClient();
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
      const result = await createPresetHealthMarker(supabase, row);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        setAddFormError(result.error.message);
        return;
      }
      setNewMarkerKind('blood_glucose');
      setNewCustomName('');
      setNewCustomUnit('');
      await refreshQuiet();
      announce('Marker added to preset.', { politeness: 'polite' });
    } finally {
      setAdding(false);
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
    const supabase = createBrowserClient();
    const patch: PresetHealthMarkerUpdate =
      next === 'custom'
        ? { marker_kind: 'custom', custom_name: null, custom_unit: null }
        : { marker_kind: next, custom_name: null, custom_unit: null };
    const result = await updatePresetHealthMarker(supabase, line.id, patch);
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Marker type updated.', { politeness: 'polite' });
  };

  const handleCustomFieldsBlur = async (
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
      announce(validation, { politeness: 'assertive' });
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
    const supabase = createBrowserClient();
    const result = await updatePresetHealthMarker(supabase, line.id, {
      custom_name: name,
      custom_unit: unit,
    });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Custom marker details saved.', { politeness: 'polite' });
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
    const supabase = createBrowserClient();
    const result = await reorderPresetHealthMarkers(
      supabase,
      presetId,
      orderedIds,
    );
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    await refreshQuiet();
    announce('Marker order updated.', { politeness: 'polite' });
  };

  const handleDeleteLine = async (
    line: PresetHealthMarkerRow,
  ): Promise<void | false> => {
    setPendingAction(true);
    try {
      const supabase = createBrowserClient();
      const result = await deletePresetHealthMarker(supabase, line.id);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      await refreshQuiet();
      announce('Marker removed from preset.', { politeness: 'polite' });
    } finally {
      setPendingAction(false);
    }
  };

  const handleDeletePreset = async (): Promise<void | false> => {
    setPendingAction(true);
    const supabase = createBrowserClient();
    const result = await deleteHealthMarkerPreset(supabase, presetId);
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      return false;
    }
    announce('Health marker preset deleted.', { politeness: 'polite' });
    router.push('/presets/health-markers');
  };

  if (authLoading) {
    return (
      <div className="w-full space-y-4">
        <p className="text-sm text-app-muted">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div role="alert" className="text-sm text-red-700 dark:text-red-300">
        You must be signed in to edit presets.
      </div>
    );
  }

  if (pageStatus === 'loading') {
    return (
      <div className="w-full space-y-4">
        <p className="text-sm text-app-muted">Loading preset…</p>
      </div>
    );
  }

  if (pageStatus === 'not_found') {
    return (
      <div className="w-full space-y-4">
        <h1 className="text-2xl font-bold text-app-ink">Preset not found</h1>
        <p className="text-sm text-app-muted">
          This preset may have been deleted or you may not have access.
        </p>
        <Link
          href="/presets/health-markers"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Back to health marker presets
        </Link>
      </div>
    );
  }

  if (pageStatus === 'error' && loadError) {
    return (
      <div className="w-full space-y-4">
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200"
        >
          {loadError}
        </div>
        <button
          type="button"
          className="min-h-[44px] rounded-full border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => {
            void refreshAll();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (!preset) {
    return null;
  }

  const deleteDialogOpen = deletePresetOpen || deleteLineTarget !== null;
  const lineControlsLocked =
    pendingAction || adding || linesSyncing || deleteDialogOpen;
  const addFormLocked = adding || linesSyncing || deleteDialogOpen;

  return (
    <div className="w-full space-y-8">
      <div>
        <Link
          href="/presets/health-markers"
          className="text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          ← Back to health marker presets
        </Link>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="edit-hm-preset-name" className="sr-only">
              Preset name
            </label>
            <input
              id="edit-hm-preset-name"
              type="text"
              value={nameDraft}
              disabled={pendingAction || deleteDialogOpen}
              onChange={(e) => {
                setNameDraft(e.target.value);
              }}
              onBlur={() => {
                void handleNameBlur();
              }}
              className="w-full border-b-2 border-transparent bg-transparent text-2xl font-bold tracking-tight text-app-ink outline-none transition focus-visible:border-app-primary focus-visible:ring-0 disabled:opacity-60"
            />
            <p className="text-sm text-app-muted">
              Name your preset, then add health markers in the order you want
              them during an episode.
            </p>
          </div>
          <button
            type="button"
            className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 shadow-sm transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
            disabled={pendingAction || deleteLineTarget !== null}
            onClick={() => {
              setDeletePresetOpen(true);
            }}
          >
            Delete preset
          </button>
        </div>
      </div>

      <section
        className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        aria-labelledby="add-marker-heading"
      >
        <h2
          id="add-marker-heading"
          className="text-lg font-semibold text-app-ink"
        >
          Add a marker
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          Choose a measurement type. For custom markers, enter a display name
          and unit (for example mg/dL or lb).
        </p>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            void handleAddMarker(e);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="new-marker-kind"
                className="text-sm font-medium text-app-ink"
              >
                Marker type
              </label>
              <select
                id="new-marker-kind"
                value={newMarkerKind}
                disabled={addFormLocked}
                onChange={(e) => {
                  setNewMarkerKind(e.target.value as PresetHealthMarkerKind);
                  setAddFormError(null);
                }}
                className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
              >
                {PRESET_HEALTH_MARKER_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {PRESET_HEALTH_MARKER_KIND_LABELS[k]}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {newMarkerKind === 'custom' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor="new-custom-name"
                  className="text-sm font-medium text-app-ink"
                >
                  Custom name
                </label>
                <input
                  id="new-custom-name"
                  type="text"
                  autoComplete="off"
                  value={newCustomName}
                  disabled={addFormLocked}
                  onChange={(e) => {
                    setNewCustomName(e.target.value);
                    setAddFormError(null);
                  }}
                  placeholder="e.g. Ketones"
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition placeholder:text-app-muted focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor="new-custom-unit"
                  className="text-sm font-medium text-app-ink"
                >
                  Unit
                </label>
                <input
                  id="new-custom-unit"
                  type="text"
                  autoComplete="off"
                  value={newCustomUnit}
                  disabled={addFormLocked}
                  onChange={(e) => {
                    setNewCustomUnit(e.target.value);
                    setAddFormError(null);
                  }}
                  placeholder="e.g. mmol/L"
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition placeholder:text-app-muted focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
                />
              </div>
            </div>
          ) : null}

          {addFormError ? (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200"
            >
              {addFormError}
            </div>
          ) : null}

          <button
            type="submit"
            disabled={addFormLocked || pendingAction}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
          >
            {adding ? 'Adding…' : linesSyncing ? 'Updating…' : 'Add to preset'}
          </button>
        </form>
      </section>

      <section aria-labelledby="marker-order-heading">
        <h2
          id="marker-order-heading"
          className="text-lg font-semibold text-app-ink"
        >
          Markers in order
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          The app will prompt for each marker in this order when you log an
          episode with this preset.
        </p>

        {linesSyncing ? (
          <p className="mt-4 text-sm text-app-muted" aria-live="polite">
            Updating marker list…
          </p>
        ) : null}

        {lines.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-app-border/90 bg-app-bg/50 p-6 text-sm text-app-muted">
            No markers yet. Add at least one using the form above.
          </p>
        ) : (
          <ol className="mt-6 space-y-4">
            {lines.map((line, index) => (
              <HealthMarkerLineEditor
                key={line.id}
                line={line}
                index={index}
                total={lines.length}
                disabled={lineControlsLocked}
                onMove={(dir) => {
                  void handleMove(index, dir);
                }}
                onRequestRemove={() => {
                  setDeleteLineTarget(line);
                }}
                onMarkerKindChange={(next) => {
                  void handleMarkerKindChange(line, next);
                }}
                onCustomFieldsBlur={(nameDraft, unitDraft) => {
                  void handleCustomFieldsBlur(line, nameDraft, unitDraft);
                }}
              />
            ))}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={deletePresetOpen}
        title="Delete this health marker preset?"
        description={`“${preset.name}” and all of its markers will be removed. This cannot be undone.`}
        confirmLabel="Delete preset"
        cancelLabel="Keep editing"
        onConfirm={() => handleDeletePreset()}
        onClose={() => {
          setDeletePresetOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteLineTarget !== null}
        title="Remove this marker?"
        description={
          deleteLineTarget
            ? `This line will be removed from the preset. This cannot be undone.`
            : undefined
        }
        confirmLabel="Remove marker"
        cancelLabel="Keep marker"
        confirmBusyLabel="Removing…"
        onConfirm={async () => {
          if (!deleteLineTarget) {
            return false;
          }
          return handleDeleteLine(deleteLineTarget);
        }}
        onClose={() => {
          setDeleteLineTarget(null);
        }}
      />
    </div>
  );
}

type HealthMarkerLineEditorProps = {
  line: PresetHealthMarkerRow;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  onRequestRemove: () => void;
  onMarkerKindChange: (next: PresetHealthMarkerKind) => void;
  onCustomFieldsBlur: (nameDraft: string, unitDraft: string) => void;
};

/**
 * One reorderable health marker row: marker type, optional custom name/unit, move/remove.
 *
 * @param props - Line data and callbacks.
 * @returns List item with controls.
 */
function HealthMarkerLineEditor({
  line,
  index,
  total,
  disabled,
  onMove,
  onRequestRemove,
  onMarkerKindChange,
  onCustomFieldsBlur,
}: HealthMarkerLineEditorProps) {
  const [nameDraft, setNameDraft] = useState(line.custom_name ?? '');
  const [unitDraft, setUnitDraft] = useState(line.custom_unit ?? '');

  useEffect(() => {
    setNameDraft(line.custom_name ?? '');
  }, [line.custom_name]);

  useEffect(() => {
    setUnitDraft(line.custom_unit ?? '');
  }, [line.custom_unit]);

  const pos = index + 1;
  const showCustom = line.marker_kind === 'custom';

  return (
    <li className="rounded-2xl border border-app-border/90 bg-app-bg/60 p-4 shadow-sm ring-1 ring-[color:var(--app-ring-slate)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          className="flex flex-1 flex-col gap-4"
          aria-label={`Marker ${pos} of ${total}`}
        >
          <div className="space-y-2">
            <label
              htmlFor={`marker-kind-${line.id}`}
              className="text-sm font-medium text-app-ink"
            >
              Marker {pos} — type
            </label>
            <select
              id={`marker-kind-${line.id}`}
              value={line.marker_kind}
              disabled={disabled}
              onChange={(e) => {
                onMarkerKindChange(e.target.value as PresetHealthMarkerKind);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
            >
              {PRESET_HEALTH_MARKER_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PRESET_HEALTH_MARKER_KIND_LABELS[k]}
                </option>
              ))}
            </select>
          </div>

          {showCustom ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <label
                  htmlFor={`custom-name-${line.id}`}
                  className="text-sm font-medium text-app-ink"
                >
                  Custom name
                </label>
                <input
                  id={`custom-name-${line.id}`}
                  type="text"
                  autoComplete="off"
                  value={nameDraft}
                  disabled={disabled}
                  onChange={(e) => {
                    setNameDraft(e.target.value);
                  }}
                  onBlur={() => {
                    onCustomFieldsBlur(nameDraft, unitDraft);
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
                />
              </div>
              <div className="space-y-2">
                <label
                  htmlFor={`custom-unit-${line.id}`}
                  className="text-sm font-medium text-app-ink"
                >
                  Unit
                </label>
                <input
                  id={`custom-unit-${line.id}`}
                  type="text"
                  autoComplete="off"
                  value={unitDraft}
                  disabled={disabled}
                  onChange={(e) => {
                    setUnitDraft(e.target.value);
                  }}
                  onBlur={() => {
                    onCustomFieldsBlur(nameDraft, unitDraft);
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
                />
              </div>
            </div>
          ) : null}
        </div>
        <div className="flex flex-col gap-2 lg:w-44">
          <div className="flex gap-2">
            <button
              type="button"
              disabled={disabled || index === 0}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-40"
              onClick={() => {
                onMove(-1);
              }}
            >
              Move up
            </button>
            <button
              type="button"
              disabled={disabled || index >= total - 1}
              className="inline-flex min-h-[44px] flex-1 items-center justify-center rounded-full border border-app-border bg-app-surface px-3 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-40"
              onClick={() => {
                onMove(1);
              }}
            >
              Move down
            </button>
          </div>
          <button
            type="button"
            disabled={disabled}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-red-200 bg-red-50 px-3 text-sm font-semibold text-red-800 shadow-sm transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
            onClick={() => {
              onRequestRemove();
            }}
          >
            Remove marker
          </button>
        </div>
      </div>
    </li>
  );
}
