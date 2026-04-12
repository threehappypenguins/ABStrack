'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import type { HealthMarkerPresetRow } from '@abstrack/types';
import {
  deleteHealthMarkerPreset,
  listHealthMarkerPresets,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';

/**
 * List of health marker presets with navigation to create and edit routes, and delete.
 * When there is no session after auth finishes loading, shows sign-in instead of an
 * endless loading state (e.g. after client-side sign-out).
 *
 * @returns Health marker presets management landing content.
 */
export function HealthMarkerPresetsListPage() {
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();
  const [presets, setPresets] = useState<HealthMarkerPresetRow[]>([]);
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'error'>(
    'loading',
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{
    id: string;
    name: string;
  } | null>(null);
  const [deleting, setDeleting] = useState(false);

  const refresh = useCallback(async () => {
    const supabase = createBrowserClient();
    setLoadState('loading');
    setLoadError(null);
    const result = await listHealthMarkerPresets(supabase);
    if (!result.ok) {
      setLoadState('error');
      setLoadError(result.error.message);
      return;
    }
    setPresets(result.data);
    setLoadState('idle');
  }, []);

  useEffect(() => {
    if (authLoading || !session) {
      return;
    }
    void refresh();
  }, [authLoading, session, refresh]);

  const handleDeleteConfirm = async (): Promise<void | false> => {
    if (!deleteTarget) {
      return false;
    }
    setDeleting(true);
    try {
      const supabase = createBrowserClient();
      const result = await deleteHealthMarkerPreset(supabase, deleteTarget.id);
      if (!result.ok) {
        announce(result.error.message, { politeness: 'assertive' });
        return false;
      }
      announce('Health marker preset deleted.', { politeness: 'polite' });
      await refresh();
    } finally {
      setDeleting(false);
    }
  };

  if (authLoading) {
    return (
      <div className="w-full space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Health marker presets
        </h1>
        <p className="text-sm text-app-muted">Loading…</p>
      </div>
    );
  }

  if (!session) {
    return (
      <div className="w-full space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Health marker presets
        </h1>
        <p className="text-sm text-app-muted" role="status">
          You need to be signed in to view and manage health marker presets.
        </p>
        <Link
          href="/login"
          className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Sign in
        </Link>
      </div>
    );
  }

  if (loadState === 'loading' && presets.length === 0) {
    return (
      <div className="w-full space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Health marker presets
        </h1>
        <p className="text-sm text-app-muted">Loading presets…</p>
      </div>
    );
  }

  if (loadState === 'error' && loadError) {
    return (
      <div className="w-full space-y-4">
        <h1 className="text-2xl font-bold tracking-tight text-app-ink">
          Health marker presets
        </h1>
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

  return (
    <div className="w-full space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Health marker presets
          </h1>
          <p className="mt-1 text-sm text-app-muted">
            Name each preset and choose which vitals or measurements to capture
            during an episode, in order.
          </p>
        </div>
        <Link
          href="/presets/health-markers/new"
          className="inline-flex min-h-[44px] shrink-0 items-center justify-center rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          Create preset
        </Link>
      </div>

      {presets.length === 0 ? (
        <div className="rounded-2xl border border-app-border/90 bg-app-surface p-8 text-center shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
          <p className="text-app-ink">
            You have not created any health marker presets yet.
          </p>
          <p className="mt-2 text-sm text-app-muted">
            Create a preset to choose markers such as glucose, blood pressure,
            or a custom measurement before you log an episode.
          </p>
          <Link
            href="/presets/health-markers/new"
            className="mt-6 inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary px-5 text-sm font-semibold text-white shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Create your first preset
          </Link>
        </div>
      ) : (
        <ul
          className="divide-y divide-app-border/80 rounded-2xl border border-app-border/90 bg-app-surface shadow-soft ring-1 ring-[color:var(--app-ring-slate)]"
          aria-label="Your health marker presets"
        >
          {presets.map((p) => (
            <li
              key={p.id}
              className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <Link
                  href={`/presets/health-markers/${p.id}`}
                  className="block rounded-md text-base font-semibold text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                >
                  {p.name}
                </Link>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link
                  href={`/presets/health-markers/${p.id}`}
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-bg px-4 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                >
                  Edit
                </Link>
                <button
                  type="button"
                  className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-red-200 bg-red-50 px-4 text-sm font-semibold text-red-800 shadow-sm transition hover:bg-red-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-900/50 dark:bg-red-950/40 dark:text-red-200 dark:hover:bg-red-950/60"
                  disabled={deleting}
                  onClick={() => {
                    setDeleteTarget({ id: p.id, name: p.name });
                  }}
                >
                  Delete
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="Delete this health marker preset?"
        description={
          deleteTarget
            ? `“${deleteTarget.name}” will be removed. This cannot be undone.`
            : undefined
        }
        confirmLabel="Delete preset"
        cancelLabel="Keep preset"
        onConfirm={() => handleDeleteConfirm()}
        onClose={() => {
          setDeleteTarget(null);
        }}
      />
    </div>
  );
}
