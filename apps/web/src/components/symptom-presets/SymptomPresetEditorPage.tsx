'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import type {
  PresetSymptomRow,
  SymptomPresetRow,
  SymptomResponseType,
} from '@abstrack/types';
import {
  ALL_ABS_SYMPTOM_SUGGESTIONS,
  SYMPTOM_RESPONSE_TYPES,
} from '@abstrack/types';
import {
  createPresetSymptom,
  deletePresetSymptom,
  deleteSymptomPreset,
  getSymptomPresetById,
  listPresetSymptomsForPreset,
  reorderPresetSymptoms,
  updatePresetSymptom,
  updateSymptomPreset,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';
import { getSymptomResponseTypeLabel } from '@/lib/symptom-presets/response-type-labels';
import { ConfirmDialog } from './ConfirmDialog';

export type SymptomPresetEditorPageProps = {
  /** `symptom_presets.id` from the route. */
  presetId: string;
};

function computeNextSortOrder(lines: PresetSymptomRow[]): number {
  if (lines.length === 0) {
    return 0;
  }
  return Math.max(...lines.map((l) => l.sort_order)) + 1;
}

/**
 * Full editor for one symptom preset: rename header, add/reorder/edit/delete lines, response types.
 *
 * @param props - Route param wiring.
 * @returns Editor UI.
 */
export function SymptomPresetEditorPage({
  presetId,
}: SymptomPresetEditorPageProps) {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();

  const [preset, setPreset] = useState<SymptomPresetRow | null>(null);
  const [lines, setLines] = useState<PresetSymptomRow[]>([]);
  const [nameDraft, setNameDraft] = useState('');
  const [pageStatus, setPageStatus] = useState<
    'loading' | 'ready' | 'not_found' | 'error'
  >('loading');
  const [loadError, setLoadError] = useState<string | null>(null);

  const [newSymptomName, setNewSymptomName] = useState('');
  const [newResponseType, setNewResponseType] =
    useState<SymptomResponseType>('yes_no');
  const [adding, setAdding] = useState(false);
  /** True while `refreshQuiet` refetches lines only (does not reset the preset name draft). */
  const [linesSyncing, setLinesSyncing] = useState(false);

  const [pendingAction, setPendingAction] = useState(false);
  const [deletePresetOpen, setDeletePresetOpen] = useState(false);
  const [deleteLineTarget, setDeleteLineTarget] =
    useState<PresetSymptomRow | null>(null);

  const refreshAll = useCallback(
    async (mode: 'full' | 'quiet' = 'full') => {
      const supabase = createBrowserClient();

      if (mode === 'quiet') {
        const linesResult = await listPresetSymptomsForPreset(
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
        getSymptomPresetById(supabase, presetId),
        listPresetSymptomsForPreset(supabase, presetId),
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
    const result = await updateSymptomPreset(supabase, preset.id, {
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

  const handleAddSymptom = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = newSymptomName.trim();
    if (!trimmed) {
      announce('Enter a symptom name or pick a suggestion.', {
        politeness: 'assertive',
      });
      return;
    }
    setAdding(true);
    try {
      const supabase = createBrowserClient();
      const sortOrder = computeNextSortOrder(lines);
      const result = await createPresetSymptom(supabase, {
        preset_id: presetId,
        sort_order: sortOrder,
        symptom_name: trimmed,
        response_type: newResponseType,
      });
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return;
      }
      setNewSymptomName('');
      setNewResponseType('yes_no');
      await refreshQuiet();
      announce('Symptom added to preset.', { politeness: 'polite' });
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
    const supabase = createBrowserClient();
    const result = await updatePresetSymptom(supabase, line.id, {
      response_type: next,
    });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Response type updated.', { politeness: 'polite' });
  };

  const handleSymptomNameBlur = async (
    line: PresetSymptomRow,
    draft: string,
  ) => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === line.symptom_name) {
      return;
    }
    setPendingAction(true);
    const supabase = createBrowserClient();
    const result = await updatePresetSymptom(supabase, line.id, {
      symptom_name: trimmed,
    });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Symptom name saved.', { politeness: 'polite' });
  };

  const handlePromptBlur = async (
    line: PresetSymptomRow,
    draft: string | null,
  ) => {
    const nextVal = draft?.trim() || null;
    const prevVal = line.prompt_instruction?.trim() || null;
    if (nextVal === prevVal) {
      return;
    }
    setPendingAction(true);
    const supabase = createBrowserClient();
    const result = await updatePresetSymptom(supabase, line.id, {
      prompt_instruction: nextVal,
    });
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    setLines((prev) => prev.map((l) => (l.id === line.id ? result.data : l)));
    announce('Instruction saved.', { politeness: 'polite' });
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
    const result = await reorderPresetSymptoms(supabase, presetId, orderedIds);
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      await refreshQuiet();
      return;
    }
    await refreshQuiet();
    announce('Symptom order updated.', { politeness: 'polite' });
  };

  const handleDeleteLine = async (
    line: PresetSymptomRow,
  ): Promise<void | false> => {
    setPendingAction(true);
    try {
      const supabase = createBrowserClient();
      const result = await deletePresetSymptom(supabase, line.id);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      await refreshQuiet();
      announce('Symptom removed from preset.', { politeness: 'polite' });
    } finally {
      setPendingAction(false);
    }
  };

  const handleDeletePreset = async (): Promise<void | false> => {
    setPendingAction(true);
    const supabase = createBrowserClient();
    const result = await deleteSymptomPreset(supabase, presetId);
    setPendingAction(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      return false;
    }
    announce('Symptom preset deleted.', { politeness: 'polite' });
    router.push('/presets/symptoms');
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
          href="/presets/symptoms"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Back to symptom presets
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

  const datalistId = 'abs-symptom-suggestions';
  const deleteDialogOpen = deletePresetOpen || deleteLineTarget !== null;
  const lineControlsLocked =
    pendingAction || adding || linesSyncing || deleteDialogOpen;
  const addFormLocked = adding || linesSyncing || deleteDialogOpen;

  return (
    <div className="w-full space-y-8">
      <div>
        <Link
          href="/presets/symptoms"
          className="text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          ← Back to symptom presets
        </Link>
        <div className="mt-4 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0 flex-1 space-y-2">
            <label htmlFor="edit-preset-name" className="sr-only">
              Preset name
            </label>
            <input
              id="edit-preset-name"
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
              Name your preset, then add symptoms in the order you want them
              during an episode.
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
        aria-labelledby="add-symptom-heading"
      >
        <h2
          id="add-symptom-heading"
          className="text-lg font-semibold text-app-ink"
        >
          Add a symptom
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          Pick a common ABS symptom from suggestions or type your own. Choose
          how each symptom should be captured when you log an episode (yes/no,
          severity scale, free text, photo, or video). Per-symptom notes during
          an episode are not part of this screen yet.
        </p>
        <datalist id={datalistId}>
          {ALL_ABS_SYMPTOM_SUGGESTIONS.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
        <form
          className="mt-6 space-y-4"
          onSubmit={(e) => {
            void handleAddSymptom(e);
          }}
        >
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <label
                htmlFor="new-symptom-name"
                className="text-sm font-medium text-app-ink"
              >
                Symptom name
              </label>
              <input
                id="new-symptom-name"
                list={datalistId}
                type="text"
                value={newSymptomName}
                disabled={addFormLocked}
                onChange={(e) => {
                  setNewSymptomName(e.target.value);
                }}
                autoComplete="off"
                placeholder="e.g. Vertigo or custom text"
                className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition placeholder:text-app-muted focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
              />
            </div>
            <div className="space-y-2">
              <label
                htmlFor="new-symptom-response"
                className="text-sm font-medium text-app-ink"
              >
                Response type
              </label>
              <select
                id="new-symptom-response"
                value={newResponseType}
                disabled={addFormLocked}
                onChange={(e) => {
                  setNewResponseType(e.target.value as SymptomResponseType);
                }}
                className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
              >
                {SYMPTOM_RESPONSE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {getSymptomResponseTypeLabel(t)}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <button
            type="submit"
            disabled={addFormLocked || pendingAction}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
          >
            {adding ? 'Adding…' : linesSyncing ? 'Updating…' : 'Add to preset'}
          </button>
        </form>
      </section>

      <section aria-labelledby="symptom-order-heading">
        <h2
          id="symptom-order-heading"
          className="text-lg font-semibold text-app-ink"
        >
          Symptoms in order
        </h2>
        <p className="mt-1 text-sm text-app-muted">
          Photo and video lines can include a short capture instruction (shown
          in the episode flow). The app will prompt for each symptom in this
          order.
        </p>

        {linesSyncing ? (
          <p className="mt-4 text-sm text-app-muted" aria-live="polite">
            Updating symptom list…
          </p>
        ) : null}

        {lines.length === 0 ? (
          <p className="mt-4 rounded-xl border border-dashed border-app-border/90 bg-app-bg/50 p-6 text-sm text-app-muted">
            No symptoms yet. Add at least one using the form above.
          </p>
        ) : (
          <ol className="mt-6 space-y-4">
            {lines.map((line, index) => (
              <SymptomLineEditor
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
                onResponseTypeChange={(next) => {
                  void handleResponseTypeChange(line, next);
                }}
                onNameBlur={(draft) => {
                  void handleSymptomNameBlur(line, draft);
                }}
                onPromptBlur={(draft) => {
                  void handlePromptBlur(line, draft);
                }}
              />
            ))}
          </ol>
        )}
      </section>

      <ConfirmDialog
        open={deletePresetOpen}
        title="Delete this symptom preset?"
        description={`“${preset.name}” and all of its symptoms will be removed. This cannot be undone.`}
        confirmLabel="Delete preset"
        cancelLabel="Keep editing"
        onConfirm={() => handleDeletePreset()}
        onClose={() => {
          setDeletePresetOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteLineTarget !== null}
        title="Remove this symptom?"
        description={
          deleteLineTarget
            ? `“${deleteLineTarget.symptom_name}” will be removed from this preset. This cannot be undone.`
            : undefined
        }
        confirmLabel="Remove symptom"
        cancelLabel="Keep symptom"
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

type SymptomLineEditorProps = {
  line: PresetSymptomRow;
  index: number;
  total: number;
  disabled: boolean;
  onMove: (direction: -1 | 1) => void;
  /** User chose to remove this line; parent opens a confirmation dialog. */
  onRequestRemove: () => void;
  onResponseTypeChange: (next: SymptomResponseType) => void;
  onNameBlur: (draft: string) => void;
  onPromptBlur: (draft: string | null) => void;
};

/**
 * Single reorderable symptom row with inline name, response type, and optional
 * photo/video capture instruction when relevant.
 *
 * @param props - Line data and callbacks.
 * @returns List item with controls.
 */
function SymptomLineEditor({
  line,
  index,
  total,
  disabled,
  onMove,
  onRequestRemove,
  onResponseTypeChange,
  onNameBlur,
  onPromptBlur,
}: SymptomLineEditorProps) {
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
  const mediaHintId = `symptom-media-hint-${line.id}`;

  return (
    <li className="rounded-2xl border border-app-border/90 bg-app-bg/60 p-4 shadow-sm ring-1 ring-[color:var(--app-ring-slate)]">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
        <div
          className="flex flex-1 flex-col gap-4"
          aria-label={`Symptom ${pos} of ${total}`}
        >
          <div className="space-y-2">
            <label
              htmlFor={`symptom-name-${line.id}`}
              className="text-sm font-medium text-app-ink"
            >
              Symptom {pos} — name
            </label>
            <input
              id={`symptom-name-${line.id}`}
              type="text"
              value={nameDraft}
              disabled={disabled}
              onChange={(e) => {
                setNameDraft(e.target.value);
              }}
              onBlur={() => {
                onNameBlur(nameDraft);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
            />
          </div>
          <div className="space-y-2">
            <label
              htmlFor={`symptom-response-${line.id}`}
              className="text-sm font-medium text-app-ink"
            >
              Response type
            </label>
            <select
              id={`symptom-response-${line.id}`}
              value={line.response_type}
              disabled={disabled}
              onChange={(e) => {
                onResponseTypeChange(e.target.value as SymptomResponseType);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink shadow-inner outline-none focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
            >
              {SYMPTOM_RESPONSE_TYPES.map((t) => (
                <option key={t} value={t}>
                  {getSymptomResponseTypeLabel(t)}
                </option>
              ))}
            </select>
          </div>
          {showMediaPrompt ? (
            <div className="space-y-2">
              <label
                htmlFor={`symptom-prompt-${line.id}`}
                className="text-sm font-medium text-app-ink"
              >
                Instruction during photo or video capture (optional)
              </label>
              <p id={mediaHintId} className="text-xs text-app-muted">
                Shown when the episode flow asks for this photo or video.
              </p>
              <textarea
                id={`symptom-prompt-${line.id}`}
                aria-describedby={mediaHintId}
                rows={2}
                value={promptDraft}
                disabled={disabled}
                onChange={(e) => {
                  setPromptDraft(e.target.value);
                }}
                onBlur={() => {
                  onPromptBlur(promptDraft);
                }}
                placeholder='e.g. "Say: The early bird catches the worm"'
                className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-sm text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring disabled:opacity-60"
              />
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
            Remove symptom
          </button>
        </div>
      </div>
    </li>
  );
}
