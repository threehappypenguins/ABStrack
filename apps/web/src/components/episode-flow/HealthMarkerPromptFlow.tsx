'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HealthMarkerRow, PresetHealthMarkerRow } from '@abstrack/types';
import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  validatePresetHealthMarkerCustomFields,
} from '@abstrack/types';
import {
  cancelActiveEpisodeById,
  getEpisodeById,
  listEpisodeHealthMarkersForEpisode,
  listPresetHealthMarkersForPreset,
  upsertEpisodeHealthMarkerForLine,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';

type MarkerDraft = {
  value: string;
  systolic: string;
  diastolic: string;
  notes: string;
};

type PersistFeedback =
  | { source: 'validation'; message: string }
  | { source: 'sync'; message: string };

function normalizeNullable(value: string | null | undefined): string | null {
  const next = value?.trim() ?? '';
  return next.length > 0 ? next : null;
}

function markerLineTitle(line: PresetHealthMarkerRow): string {
  if (line.marker_kind !== 'custom') {
    return PRESET_HEALTH_MARKER_KIND_LABELS[line.marker_kind];
  }
  const customName = normalizeNullable(line.custom_name);
  return customName ?? PRESET_HEALTH_MARKER_KIND_LABELS.custom;
}

function createDraftFromMarker(row: HealthMarkerRow | null): MarkerDraft {
  return {
    value: row?.value_numeric != null ? String(row.value_numeric) : '',
    systolic: row?.systolic_numeric != null ? String(row.systolic_numeric) : '',
    diastolic:
      row?.diastolic_numeric != null ? String(row.diastolic_numeric) : '',
    notes: row?.notes ?? '',
  };
}

function findExistingMarkerForLine(
  rows: HealthMarkerRow[],
  line: PresetHealthMarkerRow,
): HealthMarkerRow | null {
  const lineCustomName = normalizeNullable(line.custom_name);
  const lineCustomUnit = normalizeNullable(line.custom_unit);
  return (
    rows.find((row) => {
      return (
        row.marker_kind === line.marker_kind &&
        normalizeNullable(row.custom_name) === lineCustomName &&
        normalizeNullable(row.custom_unit) === lineCustomUnit
      );
    }) ?? null
  );
}

type MeasurementDraftResult =
  | {
      ok: true;
      valueNumeric: number | null;
      systolicNumeric: number | null;
      diastolicNumeric: number | null;
    }
  | { ok: false; message: string };

/**
 * Parses numeric fields the same way as {@link saveCurrentLine} (single source of truth).
 * Skip is allowed whenever this returns `ok: false` (incomplete or invalid measurement).
 */
function parseMeasurementDraftForSave(
  line: PresetHealthMarkerRow,
  draft: MarkerDraft,
): MeasurementDraftResult {
  const value = parseOptionalNumber(draft.value);
  const systolic = parseOptionalNumber(draft.systolic);
  const diastolic = parseOptionalNumber(draft.diastolic);

  if (line.marker_kind === 'blood_pressure') {
    if (systolic == null || diastolic == null) {
      return {
        ok: false,
        message:
          'Enter both systolic and diastolic blood pressure values to continue.',
      };
    }
    if (Number.isNaN(systolic) || Number.isNaN(diastolic)) {
      return {
        ok: false,
        message:
          'Blood pressure values must be valid numbers (for example 120 and 80).',
      };
    }
    return {
      ok: true,
      valueNumeric: null,
      systolicNumeric: systolic,
      diastolicNumeric: diastolic,
    };
  }
  if (value == null) {
    return { ok: false, message: 'Enter a numeric value to continue.' };
  }
  if (Number.isNaN(value)) {
    return { ok: false, message: 'Value must be a valid number.' };
  }
  return {
    ok: true,
    valueNumeric: value,
    systolicNumeric: null,
    diastolicNumeric: null,
  };
}

function parseOptionalNumber(raw: string | undefined): number | null {
  const trimmed = (raw ?? '').trim();
  if (!trimmed) {
    return null;
  }
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : Number.NaN;
}

export type HealthMarkerPromptFlowProps = {
  episodeId: string;
  resumeFromEntry?: boolean;
};

/**
 * Linear in-episode health marker stepper that runs after symptom prompts.
 *
 * @param props - Episode id and optional resume intent.
 * @returns Marker prompt UI with per-line manual entry and persistence.
 */
export function HealthMarkerPromptFlow({
  episodeId,
  resumeFromEntry = false,
}: HealthMarkerPromptFlowProps) {
  const router = useRouter();
  const { announce } = useAnnounce();
  const supabase = useMemo(() => createBrowserClient(), []);

  const [status, setStatus] = useState<'loading' | 'error' | 'ready'>(
    'loading',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [persistFeedback, setPersistFeedback] =
    useState<PersistFeedback | null>(null);
  const [phase, setPhase] = useState<'prompting' | 'complete'>('prompting');
  const [userId, setUserId] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MarkerDraft>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [saving, setSaving] = useState(false);
  const [cancelDialogOpen, setCancelDialogOpen] = useState(false);
  const [cancelingEpisode, setCancelingEpisode] = useState(false);
  const loadGenRef = useRef(0);

  const load = useCallback(async () => {
    const loadGen = ++loadGenRef.current;
    const isStale = () => loadGen !== loadGenRef.current;

    setStatus('loading');
    setErrorMessage(null);
    setPersistFeedback(null);
    setPhase('prompting');
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (isStale()) {
      return;
    }
    if (!user) {
      setErrorMessage(
        'You must be signed in to save health marker answers. Try signing in again.',
      );
      setStatus('error');
      return;
    }
    setUserId(user.id);

    const episode = await getEpisodeById(supabase, episodeId);
    if (isStale()) {
      return;
    }
    if (!episode.ok) {
      setErrorMessage(episode.error.message);
      setStatus('error');
      return;
    }
    const markerPresetId = episode.data?.health_marker_preset_id;
    if (!markerPresetId) {
      setErrorMessage(
        'This episode has no health marker preset linked. Return to the dashboard and start a new episode template.',
      );
      setStatus('error');
      return;
    }

    const [presetLines, markerRows] = await Promise.all([
      listPresetHealthMarkersForPreset(supabase, markerPresetId),
      listEpisodeHealthMarkersForEpisode(supabase, episodeId),
    ]);
    if (isStale()) {
      return;
    }
    if (!presetLines.ok) {
      setErrorMessage(presetLines.error.message);
      setStatus('error');
      return;
    }
    if (!markerRows.ok) {
      setErrorMessage(markerRows.error.message);
      setStatus('error');
      return;
    }

    setLines(presetLines.data);
    const nextDrafts: Record<string, MarkerDraft> = {};
    for (const line of presetLines.data) {
      const marker = findExistingMarkerForLine(markerRows.data, line);
      nextDrafts[line.id] = createDraftFromMarker(marker);
    }
    setDrafts(nextDrafts);

    const firstUnanswered = presetLines.data.findIndex((line) => {
      const row = findExistingMarkerForLine(markerRows.data, line);
      return row === null;
    });
    if (resumeFromEntry) {
      if (firstUnanswered === -1) {
        setPhase('complete');
      } else {
        setActiveIndex(firstUnanswered);
      }
    } else {
      setActiveIndex(0);
    }
    setStatus('ready');
  }, [episodeId, resumeFromEntry, supabase]);

  useEffect(() => {
    void load();
    return () => {
      loadGenRef.current += 1;
    };
  }, [load]);

  const currentLine = lines[activeIndex] ?? null;
  const currentDraft = currentLine
    ? (drafts[currentLine.id] ?? createDraftFromMarker(null))
    : createDraftFromMarker(null);
  const measurementReadyForSave = currentLine
    ? parseMeasurementDraftForSave(currentLine, currentDraft).ok
    : false;
  const canSkip = Boolean(currentLine) && !measurementReadyForSave;

  const onUpdateDraft = (patch: Partial<MarkerDraft>) => {
    if (!currentLine) {
      return;
    }
    setDrafts((prev) => ({
      ...prev,
      [currentLine.id]: {
        ...(prev[currentLine.id] ?? createDraftFromMarker(null)),
        ...patch,
      },
    }));
  };

  const goBackStep = () => {
    if (activeIndex <= 0 || saving) {
      return;
    }
    setActiveIndex((prev) => prev - 1);
  };

  const saveCurrentLine = async (): Promise<boolean> => {
    if (!currentLine || !userId) {
      return false;
    }
    const customValidation = validatePresetHealthMarkerCustomFields(
      currentLine.marker_kind,
      currentLine.custom_name ?? '',
      currentLine.custom_unit ?? '',
    );
    if (customValidation) {
      setPersistFeedback({ source: 'validation', message: customValidation });
      announce(customValidation, { politeness: 'assertive' });
      return false;
    }

    const parsed = parseMeasurementDraftForSave(currentLine, currentDraft);
    if (!parsed.ok) {
      setPersistFeedback({
        source: 'validation',
        message: parsed.message,
      });
      announce(parsed.message, { politeness: 'assertive' });
      return false;
    }

    setSaving(true);
    setPersistFeedback(null);
    const result = await upsertEpisodeHealthMarkerForLine(supabase, {
      userId,
      episodeId,
      line: currentLine,
      valueNumeric: parsed.valueNumeric,
      systolicNumeric: parsed.systolicNumeric,
      diastolicNumeric: parsed.diastolicNumeric,
      notes: currentDraft.notes.trim() ? currentDraft.notes.trim() : null,
    });
    setSaving(false);
    if (!result.ok) {
      setPersistFeedback({ source: 'sync', message: result.error.message });
      return false;
    }

    return true;
  };

  const goNext = async () => {
    if (saving) {
      return;
    }
    if (!currentLine) {
      setPhase('complete');
      return;
    }
    const saved = await saveCurrentLine();
    if (!saved) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      setPhase('complete');
      announce('Health marker list complete.', { politeness: 'polite' });
      return;
    }
    setActiveIndex((prev) => prev + 1);
  };

  const skipCurrent = () => {
    if (!currentLine || saving) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      setPhase('complete');
      announce('Health marker list complete.', { politeness: 'polite' });
      return;
    }
    setActiveIndex((prev) => prev + 1);
  };

  const onFinishToDashboard = () => {
    router.push('/dashboard');
  };

  const onCancelEpisodeConfirm = async (): Promise<void | false> => {
    if (cancelingEpisode) {
      return false;
    }
    setCancelingEpisode(true);
    try {
      const result = await cancelActiveEpisodeById(supabase, episodeId);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      if (result.data.didCancel) {
        announce('Episode canceled. Resume is no longer available.', {
          politeness: 'polite',
        });
      } else {
        announce('This episode is no longer active.', { politeness: 'polite' });
      }
      router.push('/dashboard');
      return;
    } finally {
      setCancelingEpisode(false);
    }
  };

  if (status === 'loading') {
    return (
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode health markers
        </h1>
        <p className="text-sm text-app-muted" role="status">
          Loading health marker list…
        </p>
      </div>
    );
  }

  if (status === 'error' && errorMessage) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode health markers
        </h1>
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {errorMessage}
        </p>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          onClick={() => {
            void load();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (phase === 'complete') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Episode health markers
        </h1>
        <div
          className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
          role="status"
          aria-live="polite"
        >
          <p className="text-sm leading-relaxed text-app-ink">
            You reached the end of your health marker list for this episode. You
            can return to the dashboard when you are ready.
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
          onClick={onFinishToDashboard}
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="mt-1 text-2xl font-bold tracking-tight text-app-ink">
            Episode health markers
          </h1>
          <p className="mt-2 text-base font-medium text-app-muted">
            Step {activeIndex + 1} of {Math.max(lines.length, 1)}
          </p>
          {persistFeedback ? (
            <p
              className="mt-2 text-sm text-amber-800 dark:text-amber-200"
              role="status"
            >
              {persistFeedback.source === 'sync'
                ? `Could not sync with the server: ${persistFeedback.message}`
                : persistFeedback.message}
            </p>
          ) : null}
        </div>

        {lines.length === 0 ? (
          <div
            className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
            role="status"
          >
            <p className="text-sm leading-relaxed text-app-ink">
              This episode&apos;s marker preset has no lines. You can return to
              the dashboard.
            </p>
          </div>
        ) : currentLine ? (
          <div className="space-y-4">
            <h2 className="text-xl font-semibold text-app-ink">
              {markerLineTitle(currentLine)}
            </h2>
            {currentLine.custom_unit ? (
              <p className="text-sm text-app-muted">
                Unit: {currentLine.custom_unit}
              </p>
            ) : null}
            {currentLine.marker_kind === 'blood_pressure' ? (
              <div className="grid gap-4 sm:grid-cols-2">
                <label className="space-y-1 text-sm font-medium text-app-ink">
                  <span>Systolic</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={currentDraft.systolic}
                    disabled={saving}
                    onChange={(e) => {
                      onUpdateDraft({ systolic: e.target.value });
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                  />
                </label>
                <label className="space-y-1 text-sm font-medium text-app-ink">
                  <span>Diastolic</span>
                  <input
                    type="number"
                    inputMode="decimal"
                    value={currentDraft.diastolic}
                    disabled={saving}
                    onChange={(e) => {
                      onUpdateDraft({ diastolic: e.target.value });
                    }}
                    className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                  />
                </label>
              </div>
            ) : (
              <label className="space-y-1 text-sm font-medium text-app-ink">
                <span>
                  Value
                  {currentLine.marker_kind === 'bac'
                    ? ' (BAC)'
                    : currentLine.custom_unit
                      ? ` (${currentLine.custom_unit})`
                      : ''}
                </span>
                <input
                  type="number"
                  inputMode="decimal"
                  value={currentDraft.value}
                  disabled={saving}
                  onChange={(e) => {
                    onUpdateDraft({ value: e.target.value });
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                />
              </label>
            )}
            <label className="space-y-1 text-sm font-medium text-app-ink">
              <span>Notes (optional)</span>
              <textarea
                rows={3}
                value={currentDraft.notes}
                disabled={saving}
                onChange={(e) => {
                  onUpdateDraft({ notes: e.target.value });
                }}
                className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
              />
            </label>
          </div>
        ) : null}

        <div className="flex flex-col gap-3 sm:flex-row">
          {activeIndex > 0 ? (
            <button
              type="button"
              className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={goBackStep}
              disabled={saving}
            >
              Back
            </button>
          ) : null}
          {currentLine ? (
            <button
              type="button"
              disabled={!canSkip || saving}
              className={`inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
                canSkip ? 'hover:bg-app-surface/80' : 'opacity-50'
              }`}
              onClick={skipCurrent}
            >
              Skip marker
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-[56px] flex-1 items-center justify-center rounded-xl bg-red-700 px-4 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
            onClick={() => {
              void goNext();
            }}
            disabled={saving}
          >
            {saving
              ? 'Saving…'
              : lines.length === 0
                ? 'Done'
                : activeIndex >= lines.length - 1
                  ? 'Finish'
                  : 'Next'}
          </button>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[44px] items-center justify-center rounded-lg px-3 py-2 text-sm font-medium text-red-700 transition hover:text-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:text-red-300 dark:hover:text-red-200"
          onClick={() => {
            setCancelDialogOpen(true);
          }}
          disabled={cancelingEpisode}
        >
          Cancel episode
        </button>
      </div>
      <ConfirmDialog
        open={cancelDialogOpen}
        title="Cancel this active episode?"
        description="Canceling permanently deletes this in-progress episode, its symptom answers, health markers, and media metadata. Food diary entries are kept, but this episode link is removed. This cannot be undone."
        confirmLabel="Cancel episode"
        confirmBusyLabel="Canceling episode…"
        cancelLabel="Keep episode"
        onConfirm={onCancelEpisodeConfirm}
        onClose={() => {
          setCancelDialogOpen(false);
        }}
      />
    </>
  );
}
