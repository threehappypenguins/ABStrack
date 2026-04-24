'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createStandaloneHealthMarkerForLine,
  listHealthMarkerPresets,
  listPresetHealthMarkersForPreset,
} from '@abstrack/supabase';
import type {
  HealthMarkerPresetRow,
  PresetHealthMarkerRow,
} from '@abstrack/types';
import {
  createDraftFromMarker,
  markerLineTitle,
  minForPresetMarkerValueInput,
  parseMeasurementDraftForSave,
  validatePresetHealthMarkerCustomFields,
  type MarkerDraft,
} from '@abstrack/types';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { useAuth } from '@/lib/auth-provider';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { PageLoading } from '@/components/page-states/PageLoading';
/**
 * Standalone, non-episode health-marker prompt flow.
 *
 * Presets with no marker lines stay on preset selection with guidance, or show
 * recovery actions if prompting ever has an empty line list.
 *
 * @returns Preset selection followed by one-line-at-a-time marker entry.
 */
export function StandaloneHealthMarkerFlow() {
  const router = useRouter();
  const { announce } = useAnnounce();
  const { session, loading: authLoading } = useAuth();
  const supabase = useMemo(() => createBrowserClient(), []);

  const [phase, setPhase] = useState<'pickPreset' | 'prompting' | 'complete'>(
    'pickPreset',
  );
  const [loadingPresets, setLoadingPresets] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [presets, setPresets] = useState<HealthMarkerPresetRow[]>([]);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [lines, setLines] = useState<PresetHealthMarkerRow[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [drafts, setDrafts] = useState<Record<string, MarkerDraft>>({});
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [presetRefetchTick, setPresetRefetchTick] = useState(0);
  const lastPresetUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    if (authLoading) {
      return;
    }

    const userId = session?.user?.id ?? null;
    if (!userId) {
      lastPresetUserIdRef.current = null;
      setPresets([]);
      setLoadError(null);
      setLoadingPresets(false);
      setPhase('pickPreset');
      setLines([]);
      setDrafts({});
      setActiveIndex(0);
      setSelectedPresetId(null);
      setFeedback(null);
      return;
    }

    const switchedAccount =
      lastPresetUserIdRef.current !== null &&
      lastPresetUserIdRef.current !== userId;
    lastPresetUserIdRef.current = userId;

    if (switchedAccount) {
      setPhase('pickPreset');
      setLines([]);
      setDrafts({});
      setActiveIndex(0);
      setSelectedPresetId(null);
      setFeedback(null);
    }

    let cancelled = false;
    setLoadingPresets(true);
    setLoadError(null);

    void (async () => {
      const result = await listHealthMarkerPresets(supabase);
      if (cancelled) {
        return;
      }
      if (!result.ok) {
        setLoadError(result.error.message);
        setLoadingPresets(false);
        return;
      }
      setPresets(result.data);
      setLoadingPresets(false);
    })();

    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user?.id, supabase, presetRefetchTick]);

  useEffect(() => {
    setFeedback(null);
  }, [activeIndex]);

  const currentLine = lines[activeIndex] ?? null;
  const currentLineId = currentLine?.id;
  const currentDraft = currentLine
    ? (drafts[currentLine.id] ?? createDraftFromMarker(null))
    : createDraftFromMarker(null);
  const measurementUnsavable = currentLine
    ? !parseMeasurementDraftForSave(currentLine, currentDraft).ok
    : true;
  const lineConfigBlocksSave = currentLine
    ? validatePresetHealthMarkerCustomFields(
        currentLine.marker_kind,
        currentLine.custom_name ?? '',
        currentLine.custom_unit ?? '',
      ) != null
    : false;
  const canSkip = currentLine
    ? measurementUnsavable || lineConfigBlocksSave
    : false;

  const patchCurrentLineDraft = useCallback(
    (patch: Partial<MarkerDraft>) => {
      if (!currentLineId) {
        return;
      }
      const id = currentLineId;
      setDrafts((prev) => {
        const base = prev[id] ?? createDraftFromMarker(null);
        return { ...prev, [id]: { ...base, ...patch } };
      });
    },
    [currentLineId],
  );

  const startPresetFlow = async () => {
    if (!selectedPresetId || saving) {
      return;
    }
    setSaving(true);
    setFeedback(null);
    const result = await listPresetHealthMarkersForPreset(
      supabase,
      selectedPresetId,
    );
    setSaving(false);
    if (!result.ok) {
      setFeedback(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    if (result.data.length === 0) {
      const message =
        'This preset has no marker lines to log yet. Add markers under Health marker presets, or choose a different preset.';
      setFeedback(message);
      announce(message, { politeness: 'polite' });
      return;
    }
    const nextDrafts: Record<string, MarkerDraft> = {};
    for (const line of result.data) {
      nextDrafts[line.id] = createDraftFromMarker(null);
    }
    setDrafts(nextDrafts);
    setLines(result.data);
    setActiveIndex(0);
    setPhase('prompting');
    announce('Health marker logging started.', { politeness: 'polite' });
  };

  const saveCurrentLine = async (): Promise<boolean> => {
    if (!currentLine || !session?.user?.id) {
      return false;
    }
    const customValidation = validatePresetHealthMarkerCustomFields(
      currentLine.marker_kind,
      currentLine.custom_name ?? '',
      currentLine.custom_unit ?? '',
    );
    if (customValidation) {
      setFeedback(customValidation);
      announce(customValidation, { politeness: 'assertive' });
      return false;
    }
    const parsed = parseMeasurementDraftForSave(currentLine, currentDraft);
    if (!parsed.ok) {
      setFeedback(parsed.message);
      announce(parsed.message, { politeness: 'assertive' });
      return false;
    }
    setSaving(true);
    setFeedback(null);
    const result = await createStandaloneHealthMarkerForLine(supabase, {
      userId: session.user.id,
      line: currentLine,
      valueNumeric: parsed.valueNumeric,
      systolicNumeric: parsed.systolicNumeric,
      diastolicNumeric: parsed.diastolicNumeric,
      notes: currentDraft.notes.trim() ? currentDraft.notes.trim() : null,
    });
    setSaving(false);
    if (!result.ok) {
      setFeedback(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return false;
    }
    return true;
  };

  const onNext = async () => {
    if (saving || !currentLine) {
      return;
    }
    const saved = await saveCurrentLine();
    if (!saved) {
      return;
    }
    if (activeIndex >= lines.length - 1) {
      setFeedback(null);
      setPhase('complete');
      announce('Standalone health markers saved.', { politeness: 'polite' });
      return;
    }
    setActiveIndex((prev) => prev + 1);
  };

  if (authLoading) {
    return <PageLoading title="Log health markers" />;
  }

  if (!session) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Log health markers
        </h1>
        <p className="text-sm text-app-muted">You need to be signed in.</p>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary px-5 text-sm font-semibold text-white"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (loadingPresets) {
    return <PageLoading title="Log health markers" />;
  }

  if (phase === 'complete') {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Health markers saved
        </h1>
        <p className="text-sm text-app-muted" role="status">
          Your marker entries were saved.
        </p>
        <button
          type="button"
          onClick={() => {
            router.push('/dashboard');
          }}
          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-red-700 px-5 text-sm font-semibold text-white"
        >
          Back to dashboard
        </button>
      </div>
    );
  }

  if (phase === 'pickPreset') {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Log health markers
          </h1>
          <p className="mt-2 text-sm text-app-muted">
            Choose a health marker preset to log vitals without starting an
            episode.
          </p>
        </div>
        {loadError ? (
          <div className="space-y-3">
            <p className="text-sm text-red-700 dark:text-red-300" role="alert">
              {loadError}
            </p>
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={() => {
                setPresetRefetchTick((n) => n + 1);
              }}
            >
              Try again
            </button>
          </div>
        ) : null}
        {!loadError && presets.length === 0 ? (
          <div className="rounded-2xl border border-app-border/90 bg-app-surface p-6">
            <p className="text-sm leading-relaxed text-app-ink">
              You do not have any health marker presets yet. Create one under{' '}
              <Link
                href="/presets/health-markers"
                className="font-medium text-app-primary underline"
              >
                Health marker presets
              </Link>
              .
            </p>
          </div>
        ) : !loadError && presets.length > 0 ? (
          <fieldset className="space-y-3">
            <legend className="text-base font-semibold text-app-ink">
              Choose one preset
            </legend>
            {presets.map((preset) => (
              <label
                key={preset.id}
                className="flex min-h-[56px] cursor-pointer items-center gap-3 rounded-xl border border-app-border bg-app-surface px-4 py-3"
              >
                <input
                  type="radio"
                  name="marker-preset"
                  checked={selectedPresetId === preset.id}
                  onChange={() => {
                    setSelectedPresetId(preset.id);
                    setFeedback(null);
                  }}
                />
                <span className="text-base font-medium text-app-ink">
                  {preset.name}
                </span>
              </label>
            ))}
          </fieldset>
        ) : null}
        {feedback ? (
          <p className="text-sm text-red-700 dark:text-red-300" role="alert">
            {feedback}
          </p>
        ) : null}
        {!loadError && presets.length > 0 ? (
          <button
            type="button"
            disabled={!selectedPresetId || saving}
            onClick={() => {
              void startPresetFlow();
            }}
            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Loading…' : 'Start logging'}
          </button>
        ) : null}
      </div>
    );
  }

  if (lines.length === 0) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Standalone health markers
          </h1>
          <p className="mt-2 text-sm text-app-muted" role="status">
            This preset has no marker lines to log. Nothing was saved.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
          <button
            type="button"
            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-5 text-base font-semibold text-app-ink shadow-sm transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={() => {
              setPhase('pickPreset');
              setLines([]);
              setDrafts({});
              setActiveIndex(0);
              setFeedback(null);
              setSelectedPresetId(null);
              announce('Choose a health marker preset.', {
                politeness: 'polite',
              });
            }}
          >
            Choose another preset
          </button>
          <button
            type="button"
            className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
            onClick={() => {
              router.push('/dashboard');
            }}
          >
            Back to dashboard
          </button>
        </div>
        <p className="text-sm text-app-muted">
          Add lines to this preset under{' '}
          <Link
            href="/presets/health-markers"
            className="font-medium text-app-primary underline decoration-app-primary/40 underline-offset-2 outline-none hover:text-app-ink focus-visible:ring-2 focus-visible:ring-app-ring"
          >
            Health marker presets
          </Link>
          .
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Standalone health markers
        </h1>
        <p className="mt-2 text-sm text-app-muted">
          {`Step ${activeIndex + 1} of ${lines.length}`}
        </p>
      </div>

      {feedback ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {feedback}
        </p>
      ) : null}

      {currentLine ? (
        <div className="space-y-4">
          <h2 className="text-xl font-semibold text-app-ink">
            {markerLineTitle(currentLine)}
          </h2>
          {currentLine.marker_kind === 'blood_pressure' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="space-y-1 text-sm font-medium text-app-ink">
                <span>Systolic</span>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={currentDraft.systolic}
                  disabled={saving}
                  onChange={(e) => {
                    patchCurrentLineDraft({ systolic: e.target.value });
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink"
                />
              </label>
              <label className="space-y-1 text-sm font-medium text-app-ink">
                <span>Diastolic</span>
                <input
                  type="number"
                  step="any"
                  min={0}
                  value={currentDraft.diastolic}
                  disabled={saving}
                  onChange={(e) => {
                    patchCurrentLineDraft({ diastolic: e.target.value });
                  }}
                  className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink"
                />
              </label>
            </div>
          ) : (
            <label className="space-y-1 text-sm font-medium text-app-ink">
              <span>Value</span>
              <input
                type="number"
                step="any"
                min={minForPresetMarkerValueInput(currentLine.marker_kind)}
                value={currentDraft.value}
                disabled={saving}
                onChange={(e) => {
                  patchCurrentLineDraft({ value: e.target.value });
                }}
                className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink"
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
                patchCurrentLineDraft({ notes: e.target.value });
              }}
              className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink"
            />
          </label>
        </div>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row">
        {currentLine ? (
          <button
            type="button"
            disabled={!canSkip || saving}
            onClick={() => {
              if (activeIndex >= lines.length - 1) {
                setFeedback(null);
                setPhase('complete');
                return;
              }
              setActiveIndex((prev) => prev + 1);
            }}
            className="inline-flex min-h-[56px] items-center justify-center rounded-xl border border-app-border bg-app-surface px-4 text-base font-semibold text-app-ink disabled:opacity-50"
          >
            Skip marker
          </button>
        ) : null}
        <button
          type="button"
          disabled={saving || !currentLine}
          onClick={() => {
            void onNext();
          }}
          className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-4 text-base font-semibold text-white disabled:opacity-50"
        >
          {saving
            ? 'Saving…'
            : activeIndex >= lines.length - 1
              ? 'Finish'
              : 'Next'}
        </button>
      </div>
    </div>
  );
}
