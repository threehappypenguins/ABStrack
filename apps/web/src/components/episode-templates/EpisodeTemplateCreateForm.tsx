'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  validateEpisodeTemplateName,
  validateEpisodeTemplatePresetPair,
} from '@abstrack/types';
import {
  createEpisodeTemplate,
  listHealthMarkerPresets,
  listSymptomPresets,
  resolvePhiSubjectUserContextFromSupabase,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';
import {
  useUnsavedChangesLeaveGuard,
  type PendingLeaveAction,
} from '@/lib/use-unsaved-changes-leave-guard';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';

/**
 * Form to create an episode template: display name plus paired symptom and health marker presets.
 *
 * Preset picklists load after {@link resolvePhiSubjectUserContextFromSupabase}; health marker options
 * call {@link listHealthMarkerPresets} with `scopeUserId` so the dropdown matches the PHI subject
 * used when saving the template.
 *
 * @returns Create episode template page content.
 */
export function EpisodeTemplateCreateForm() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();
  const [name, setName] = useState('');
  const [symptomPresetId, setSymptomPresetId] = useState('');
  const [healthMarkerPresetId, setHealthMarkerPresetId] = useState('');
  const [symptomOptions, setSymptomOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [markerOptions, setMarkerOptions] = useState<
    { id: string; name: string }[]
  >([]);
  const [listsLoading, setListsLoading] = useState(true);
  const [listsError, setListsError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [discardDialogOpen, setDiscardDialogOpen] = useState(false);
  const pendingLeaveRef = useRef<PendingLeaveAction | null>(null);

  const isDirty = useMemo(() => {
    const nameTrimmed = name.trim();
    return (
      nameTrimmed !== '' ||
      symptomPresetId !== '' ||
      healthMarkerPresetId !== ''
    );
  }, [name, symptomPresetId, healthMarkerPresetId]);

  const onRequestDiscardDialog = useCallback(() => {
    setDiscardDialogOpen(true);
  }, []);

  useUnsavedChangesLeaveGuard({
    active: isDirty && !!session,
    blockIntercepts: saving,
    dialogOpen: discardDialogOpen,
    pendingLeaveRef,
    onRequestDiscard: onRequestDiscardDialog,
    exemptFormId: 'episode-template-create-form',
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

  const requestLeaveCreate = useCallback(() => {
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

  useEffect(() => {
    if (authLoading || !session?.user.id) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setListsLoading(true);
      setListsError(null);
      const supabase = createBrowserClient();
      const phiRes = await resolvePhiSubjectUserContextFromSupabase(
        supabase,
        session.user.id,
      );
      if (cancelled) {
        return;
      }
      if (!phiRes.ok || phiRes.data == null) {
        setListsError(
          phiRes.ok
            ? 'You must be signed in to load presets for this account.'
            : phiRes.error.message,
        );
        setListsLoading(false);
        return;
      }
      const scopeUserId = phiRes.data.phiSubjectUserId;
      const [symRes, hmRes] = await Promise.all([
        listSymptomPresets(supabase),
        listHealthMarkerPresets(supabase, { scopeUserId }),
      ]);
      if (cancelled) {
        return;
      }
      if (!symRes.ok) {
        setListsError(symRes.error.message);
        setListsLoading(false);
        return;
      }
      if (!hmRes.ok) {
        setListsError(hmRes.error.message);
        setListsLoading(false);
        return;
      }
      setSymptomOptions(symRes.data.map((r) => ({ id: r.id, name: r.name })));
      setMarkerOptions(hmRes.data.map((r) => ({ id: r.id, name: r.name })));
      setListsLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [authLoading, session?.user.id]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user.id) {
      setError('You must be signed in to create a template.');
      return;
    }
    const nameCheck = validateEpisodeTemplateName(name);
    if (!nameCheck.ok) {
      setError(nameCheck.message);
      announce(nameCheck.message, { politeness: 'assertive' });
      return;
    }
    const pair = validateEpisodeTemplatePresetPair(
      symptomPresetId,
      healthMarkerPresetId,
    );
    if (!pair.ok) {
      setError(pair.message);
      announce(pair.message, { politeness: 'assertive' });
      return;
    }
    setSaving(true);
    setError(null);
    const supabase = createBrowserClient();
    const phiRes = await resolvePhiSubjectUserContextFromSupabase(
      supabase,
      session.user.id,
    );
    if (!phiRes.ok || phiRes.data == null) {
      setSaving(false);
      const msg = phiRes.ok
        ? 'You must be signed in to save an episode template.'
        : phiRes.error.message;
      setError(msg);
      announce(msg, { politeness: 'assertive' });
      return;
    }
    const result = await createEpisodeTemplate(supabase, {
      user_id: phiRes.data.phiSubjectUserId,
      name: nameCheck.name,
      symptom_preset_id: symptomPresetId,
      health_marker_preset_id: healthMarkerPresetId,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    announce('Episode template saved.', { politeness: 'polite' });
    router.push('/presets/episode-templates');
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
        You must be signed in to create a template.
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
            requestLeaveCreate();
          }}
          className="text-left text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
        >
          ← Back to episode templates
        </button>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
          New episode template
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Choose a clear name and which symptom list and marker list belong
          together. This pairing is saved explicitly — similar preset names do
          not link automatically.
        </p>
      </div>

      {listsLoading ? (
        <p className="text-sm text-app-muted">Loading your presets…</p>
      ) : null}
      {listsError ? (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200"
        >
          {listsError}
        </div>
      ) : null}

      <form
        id="episode-template-create-form"
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        noValidate
      >
        <div className="space-y-6">
          <div className="space-y-2">
            <label
              htmlFor="episode-template-name"
              className="text-sm font-medium text-app-ink"
            >
              Template name
            </label>
            <input
              id="episode-template-name"
              name="episodeTemplateName"
              type="text"
              autoComplete="off"
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
              }}
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition placeholder:text-app-muted focus-visible:ring-2 focus-visible:ring-app-ring"
              placeholder='e.g. "ABS Episode"'
              aria-describedby="episode-template-name-hint"
            />
            <p
              id="episode-template-name-hint"
              className="text-sm text-app-muted"
            >
              This is the label you will tap when starting an episode — keep it
              short and familiar.
            </p>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="episode-template-symptom-preset"
              className="text-sm font-medium text-app-ink"
            >
              Symptom preset
            </label>
            <select
              id="episode-template-symptom-preset"
              name="symptomPresetId"
              value={symptomPresetId}
              onChange={(e) => {
                setSymptomPresetId(e.target.value);
              }}
              required
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              <option value="">Select a symptom preset…</option>
              {symptomOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-2">
            <label
              htmlFor="episode-template-marker-preset"
              className="text-sm font-medium text-app-ink"
            >
              Health marker preset
            </label>
            <select
              id="episode-template-marker-preset"
              name="healthMarkerPresetId"
              value={healthMarkerPresetId}
              onChange={(e) => {
                setHealthMarkerPresetId(e.target.value);
              }}
              required
              className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition focus-visible:ring-2 focus-visible:ring-app-ring"
            >
              <option value="">Select a health marker preset…</option>
              {markerOptions.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {error ? (
          <div
            role="alert"
            className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800 dark:border-red-800/60 dark:bg-red-950/35 dark:text-red-200"
          >
            {error}
          </div>
        ) : null}

        <div className="mt-8 flex flex-wrap gap-3">
          <button
            type="submit"
            disabled={saving || listsLoading || !!listsError}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
          >
            {saving ? 'Saving…' : 'Save template'}
          </button>
          <button
            type="button"
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-bg px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
            onClick={() => {
              requestLeaveCreate();
            }}
          >
            Cancel
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
    </div>
  );
}
