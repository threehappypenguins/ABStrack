'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { EpisodeTemplateWithPresetsRow } from '@abstrack/types';
import {
  normalizeEpisodeTemplateName,
  validateEpisodeTemplateName,
  validateEpisodeTemplatePresetPair,
} from '@abstrack/types';
import {
  deleteEpisodeTemplate,
  getEpisodeTemplateById,
  listHealthMarkerPresets,
  listSymptomPresets,
  updateEpisodeTemplate,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';
import {
  useUnsavedChangesLeaveGuard,
  type PendingLeaveAction,
} from '@/lib/use-unsaved-changes-leave-guard';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';

export type EpisodeTemplateEditorPageProps = {
  /** `episode_templates.id` from the route. */
  templateId: string;
};

/**
 * Edit an episode template: rename and/or change which symptom and health marker presets are paired.
 *
 * @param props - Route param wiring.
 * @returns Editor UI.
 */
export function EpisodeTemplateEditorPage({
  templateId,
}: EpisodeTemplateEditorPageProps) {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();

  const [row, setRow] = useState<EpisodeTemplateWithPresetsRow | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  const [symptomPresetId, setSymptomPresetId] = useState('');
  const [healthMarkerPresetId, setHealthMarkerPresetId] = useState('');
  const [symptomOptions, setSymptomOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [markerOptions, setMarkerOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [pageStatus, setPageStatus] = useState<
    'loading' | 'ready' | 'not_found' | 'error'
  >('loading');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const pendingLeaveRef = useRef<PendingLeaveAction | null>(null);

  const refresh = useCallback(async () => {
    const supabase = createBrowserClient();
    setPageStatus('loading');
    setLoadError(null);
    const [templateResult, symRes, hmRes] = await Promise.all([
      getEpisodeTemplateById(supabase, templateId),
      listSymptomPresets(supabase),
      listHealthMarkerPresets(supabase),
    ]);
    if (!symRes.ok) {
      setPageStatus('error');
      setLoadError(symRes.error.message);
      return;
    }
    if (!hmRes.ok) {
      setPageStatus('error');
      setLoadError(hmRes.error.message);
      return;
    }
    setSymptomOptions(symRes.data.map((r) => ({ id: r.id, name: r.name })));
    setMarkerOptions(hmRes.data.map((r) => ({ id: r.id, name: r.name })));

    if (!templateResult.ok) {
      setPageStatus('error');
      setLoadError(templateResult.error.message);
      return;
    }
    if (!templateResult.data) {
      setPageStatus('not_found');
      return;
    }
    const t = templateResult.data;
    setRow(t);
    setNameDraft(normalizeEpisodeTemplateName(t.name));
    setSymptomPresetId(t.symptom_preset_id);
    setHealthMarkerPresetId(t.health_marker_preset_id);
    setPageStatus('ready');
  }, [templateId]);

  useEffect(() => {
    if (authLoading || !session) {
      return;
    }
    void refresh();
  }, [authLoading, session, refresh]);

  useEffect(() => {
    if (saving && deleteOpen) {
      setDeleteOpen(false);
    }
  }, [saving, deleteOpen]);

  const isDirty = useMemo(() => {
    if (!row) {
      return false;
    }
    const draftName = normalizeEpisodeTemplateName(nameDraft);
    const storedName = normalizeEpisodeTemplateName(row.name);
    return (
      draftName !== storedName ||
      symptomPresetId !== row.symptom_preset_id ||
      healthMarkerPresetId !== row.health_marker_preset_id
    );
  }, [row, nameDraft, symptomPresetId, healthMarkerPresetId]);

  const onRequestDiscardDialog = useCallback(() => {
    setDiscardDialogOpen(true);
  }, []);

  useUnsavedChangesLeaveGuard({
    active: isDirty && pageStatus === 'ready' && !!row,
    blockIntercepts: saving,
    dialogOpen: discardDialogOpen,
    pendingLeaveRef,
    onRequestDiscard: onRequestDiscardDialog,
    exemptFormId: 'episode-template-edit-form',
  });

  const navigateToTemplatesList = useCallback(() => {
    router.push('/presets/episode-templates');
  }, [router]);

  const handleDiscardConfirm = useCallback(() => {
    const action = pendingLeaveRef.current;
    pendingLeaveRef.current = null;

    if (!action) {
      router.push('/presets/episode-templates');
      return;
    }
    if (action.kind === 'form') {
      action.form.submit();
      return;
    }
    const { href } = action;
    let url: URL;
    try {
      url = new URL(href, window.location.origin);
    } catch {
      router.push('/presets/episode-templates');
      return;
    }
    if (url.origin !== window.location.origin) {
      window.location.assign(href);
      return;
    }
    router.push(`${url.pathname}${url.search}${url.hash}`);
  }, [router]);

  const requestLeaveEditor = useCallback(() => {
    if (!isDirty) {
      navigateToTemplatesList();
      return;
    }
    pendingLeaveRef.current = {
      kind: 'href',
      href: '/presets/episode-templates',
    };
    setDiscardDialogOpen(true);
  }, [isDirty, navigateToTemplatesList]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!row) {
      return;
    }
    const nameCheck = validateEpisodeTemplateName(nameDraft);
    if (!nameCheck.ok) {
      announce(nameCheck.message, { politeness: 'assertive' });
      return;
    }
    const pair = validateEpisodeTemplatePresetPair(
      symptomPresetId,
      healthMarkerPresetId,
    );
    if (!pair.ok) {
      announce(pair.message, { politeness: 'assertive' });
      return;
    }
    const unchanged =
      nameCheck.name === normalizeEpisodeTemplateName(row.name) &&
      symptomPresetId === row.symptom_preset_id &&
      healthMarkerPresetId === row.health_marker_preset_id;
    if (unchanged) {
      announce('No changes to save.', { politeness: 'polite' });
      return;
    }
    setSaving(true);
    const supabase = createBrowserClient();
    const result = await updateEpisodeTemplate(supabase, row.id, {
      name: nameCheck.name,
      symptom_preset_id: symptomPresetId,
      health_marker_preset_id: healthMarkerPresetId,
    });
    setSaving(false);
    if (!result.ok) {
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    announce('Episode template saved.', { politeness: 'polite' });
    navigateToTemplatesList();
  };

  const handleDeleteConfirm = async (): Promise<void | false> => {
    if (!row) {
      return false;
    }
    setDeleting(true);
    try {
      const supabase = createBrowserClient();
      const result = await deleteEpisodeTemplate(supabase, row.id);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      announce('Episode template deleted.', { politeness: 'polite' });
      router.push('/presets/episode-templates');
    } finally {
      setDeleting(false);
    }
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
        You must be signed in to edit templates.
      </div>
    );
  }

  if (pageStatus === 'loading' && !row) {
    return (
      <div className="w-full space-y-4">
        <p className="text-sm text-app-muted">Loading template…</p>
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
            void refresh();
          }}
        >
          Try again
        </button>
      </div>
    );
  }

  if (pageStatus === 'not_found' || !row) {
    return (
      <div className="w-full space-y-4">
        <p className="text-app-ink">We could not find that episode template.</p>
        <Link
          href="/presets/episode-templates"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Back to episode templates
        </Link>
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <div>
        <button
          type="button"
          disabled={saving}
          onClick={() => {
            requestLeaveEditor();
          }}
          className="text-left text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          ← Back to episode templates
        </button>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
          Edit episode template
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Update the name or the paired presets. Changes apply only to this
          template row.
        </p>
      </div>

      <form
        id="episode-template-edit-form"
        onSubmit={(e) => {
          void handleSave(e);
        }}
        className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        noValidate
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="edit-episode-template-name"
              className="text-sm font-medium text-app-ink"
            >
              Template name
            </label>
            <input
              id="edit-episode-template-name"
              name="episodeTemplateName"
              type="text"
              autoComplete="off"
              value={nameDraft}
              onChange={(e) => {
                setNameDraft(e.target.value);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition placeholder:text-app-muted focus-visible:ring-2 focus-visible:ring-app-ring"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="edit-episode-template-symptom"
              className="text-sm font-medium text-app-ink"
            >
              Symptom preset
            </label>
            <select
              id="edit-episode-template-symptom"
              name="symptomPresetId"
              value={symptomPresetId}
              onChange={(e) => {
                setSymptomPresetId(e.target.value);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              {symptomOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="edit-episode-template-marker"
              className="text-sm font-medium text-app-ink"
            >
              Health marker preset
            </label>
            <select
              id="edit-episode-template-marker"
              name="healthMarkerPresetId"
              value={healthMarkerPresetId}
              onChange={(e) => {
                setHealthMarkerPresetId(e.target.value);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              {markerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          <button
            type="button"
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-bg px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
            onClick={() => {
              requestLeaveEditor();
            }}
          >
            Cancel
          </button>
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-red-200 bg-red-50 px-5 text-sm font-semibold text-red-800 shadow-sm transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
            disabled={saving || deleting}
            onClick={() => {
              setDeleteOpen(true);
            }}
          >
            Delete template
          </button>
        </div>
      </form>

      <ConfirmDialog
        open={discardDialogOpen}
        title="Discard unsaved changes?"
        description="You have edits that are not saved yet. If you leave now, those changes will be lost."
        confirmLabel="Discard changes"
        cancelLabel="Keep editing"
        onConfirm={() => {
          handleDiscardConfirm();
        }}
        onClose={() => {
          pendingLeaveRef.current = null;
          setDiscardDialogOpen(false);
        }}
      />

      <ConfirmDialog
        open={deleteOpen}
        title="Delete this episode template?"
        description={`“${row.name}” will be removed. This cannot be undone.`}
        confirmLabel="Delete template"
        cancelLabel="Keep template"
        onConfirm={() => handleDeleteConfirm()}
        onClose={() => {
          setDeleteOpen(false);
        }}
      />
    </div>
  );
}
