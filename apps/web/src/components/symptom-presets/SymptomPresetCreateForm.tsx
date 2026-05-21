'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import {
  createSymptomPreset,
  resolvePhiSubjectUserContextFromSupabase,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import { useAuth } from '@/lib/auth-provider';

/**
 * Form to create an empty symptom preset header, then navigate to the editor for lines.
 *
 * @returns Create preset page content.
 */
export function SymptomPresetCreateForm() {
  const router = useRouter();
  const { session, loading: authLoading } = useAuth();
  const { announce } = useAnnounce();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session?.user.id) {
      setError('You must be signed in to create a preset.');
      return;
    }
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Enter a name for this preset.');
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
        ? 'You must be signed in to create a preset.'
        : phiRes.error.message;
      setError(msg);
      announce(msg, { politeness: 'assertive' });
      return;
    }
    const result = await createSymptomPreset(supabase, {
      user_id: phiRes.data.phiSubjectUserId,
      name: trimmed,
    });
    setSaving(false);
    if (!result.ok) {
      setError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    announce('Preset created. Add symptoms below.', { politeness: 'polite' });
    router.push(`/presets/symptoms/${result.data.id}`);
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
        You must be signed in to create a preset.
      </div>
    );
  }

  return (
    <div className="w-full space-y-8">
      <div>
        <Link
          href="/presets/symptoms"
          className="text-sm font-medium text-app-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
        >
          ← Back to symptom presets
        </Link>
        <h1 className="mt-4 text-2xl font-bold tracking-tight text-app-ink">
          New symptom preset
        </h1>
        <p className="mt-1 text-sm text-app-muted">
          Choose a name, then add symptoms and response types on the next
          screen.
        </p>
      </div>

      <form
        onSubmit={(e) => {
          void onSubmit(e);
        }}
        className="rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8"
        noValidate
      >
        <div className="space-y-2">
          <label
            htmlFor="preset-name"
            className="text-sm font-medium text-app-ink"
          >
            Preset name
          </label>
          <input
            id="preset-name"
            name="presetName"
            type="text"
            autoComplete="off"
            required
            value={name}
            onChange={(e) => {
              setName(e.target.value);
            }}
            className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-bg px-3 text-app-ink shadow-inner outline-none transition placeholder:text-app-muted focus-visible:ring-2 focus-visible:ring-app-ring"
            placeholder="e.g. Typical ABS episode"
          />
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
            disabled={saving}
            className="inline-flex min-h-[44px] items-center justify-center rounded-full bg-app-primary-solid px-5 text-sm font-semibold text-app-on-primary-solid shadow-sm transition hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60"
          >
            {saving ? 'Creating…' : 'Create and edit symptoms'}
          </button>
          <Link
            href="/presets/symptoms"
            className="inline-flex min-h-[44px] items-center justify-center rounded-full border border-app-border bg-app-bg px-5 text-sm font-semibold text-app-ink shadow-sm transition hover:bg-[var(--app-nav-hover-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
          >
            Cancel
          </Link>
        </div>
      </form>
    </div>
  );
}
