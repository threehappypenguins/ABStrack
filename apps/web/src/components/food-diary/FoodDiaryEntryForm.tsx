'use client';

import { useMemo, useState } from 'react';
import type { MealTag } from '@abstrack/types';
import { MEAL_TAGS } from '@abstrack/types';
import {
  createFoodDiaryEntry,
  resolvePhiSubjectUserContextFromSupabase,
} from '@abstrack/supabase';
import { useAnnounce } from '@abstrack/ui/a11y-web';
import { createBrowserClient } from '@/lib/supabase/browser-client';
import {
  localInputValueToIso,
  toLocalDateTimeInputValue,
} from '@/lib/food-diary/date-time';

type FoodDiaryEntryFormProps = {
  episodeId?: string | null;
  heading?: string;
  description?: string;
  submitLabel?: string;
  onSaved?: () => void;
};

type LastSavedSummary = {
  mealTag: MealTag;
  loggedAtIso: string;
};

/**
 * Food diary entry form used from home and episode-end flow.
 *
 * Standalone entries (`episodeId` null) collapse after save with a confirmation
 * and an action to start a fresh entry. Episode-linked entries keep inline
 * success feedback with the form visible.
 *
 * @param props - Form settings and completion callback.
 * @returns Accessible form for meal tag, note, and logged timestamp.
 */
export function FoodDiaryEntryForm({
  episodeId = null,
  heading = 'Food diary',
  description = 'Log what you ate or drank. Time defaults to now and can be adjusted.',
  submitLabel = 'Save food entry',
  onSaved,
}: FoodDiaryEntryFormProps) {
  const { announce } = useAnnounce();
  const supabase = useMemo(() => createBrowserClient(), []);
  const isStandalone = episodeId == null;

  const [mealTag, setMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const [loggedAtLocal, setLoggedAtLocal] = useState(() =>
    toLocalDateTimeInputValue(new Date().toISOString()),
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  /** Bumped when starting a new standalone entry so inputs remount like a fresh page load. */
  const [formInstanceKey, setFormInstanceKey] = useState(0);
  const [standaloneSaved, setStandaloneSaved] = useState(false);
  const [lastSaved, setLastSaved] = useState<LastSavedSummary | null>(null);

  const resetToFreshEntry = () => {
    setMealTag(null);
    setFoodNote('');
    setLoggedAtLocal(toLocalDateTimeInputValue(new Date().toISOString()));
    setErrorMessage(null);
    setSuccessMessage(null);
    setStandaloneSaved(false);
    setLastSaved(null);
    setFormInstanceKey((k) => k + 1);
  };

  const onSubmit = async () => {
    if (saving) {
      return;
    }
    setSaving(true);
    setErrorMessage(null);
    setSuccessMessage(null);

    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      const message = 'You must be signed in to save a food diary entry.';
      setErrorMessage(message);
      announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }

    const phiRes = await resolvePhiSubjectUserContextFromSupabase(
      supabase,
      user.id,
    );
    if (!phiRes.ok || phiRes.data == null) {
      const message = phiRes.ok
        ? 'You must be signed in to save a food diary entry.'
        : phiRes.error.message;
      setErrorMessage(message);
      announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }

    const loggedAtIso = localInputValueToIso(loggedAtLocal);
    if (!mealTag) {
      const message = 'Choose a meal tag.';
      setErrorMessage(message);
      announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }
    if (!loggedAtIso) {
      const message = 'Enter a valid date and time.';
      setErrorMessage(message);
      announce(message, { politeness: 'assertive' });
      setSaving(false);
      return;
    }

    const result = await createFoodDiaryEntry(supabase, {
      user_id: phiRes.data.phiSubjectUserId,
      episode_id: episodeId,
      meal_tag: mealTag,
      food_note: foodNote,
      logged_at: loggedAtIso,
    });
    setSaving(false);
    if (!result.ok) {
      setErrorMessage(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }

    if (isStandalone) {
      setLastSaved({ mealTag, loggedAtIso });
      setMealTag(null);
      setFoodNote('');
      setLoggedAtLocal(toLocalDateTimeInputValue(new Date().toISOString()));
      setStandaloneSaved(true);
    } else {
      setSuccessMessage('Food entry saved and linked to this episode.');
      setFoodNote('');
      setLoggedAtLocal(toLocalDateTimeInputValue(new Date().toISOString()));
    }
    announce('Food entry saved.', { politeness: 'polite' });
    onSaved?.();
  };

  const savedLoggedAtDisplay =
    lastSaved != null
      ? new Date(lastSaved.loggedAtIso).toLocaleString(undefined, {
          dateStyle: 'medium',
          timeStyle: 'short',
        })
      : '';

  if (isStandalone && standaloneSaved && lastSaved != null) {
    return (
      <section className="space-y-5 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8">
        <div>
          <h2 className="text-xl font-semibold tracking-tight text-app-ink">
            {heading}
          </h2>
        </div>
        <div
          className="rounded-xl border border-green-200/80 bg-green-50 p-4 dark:border-green-800/60 dark:bg-green-950/35"
          role="status"
          aria-live="polite"
        >
          <p className="text-base font-medium text-green-900 dark:text-green-100">
            Food entry saved.
          </p>
          <p className="mt-2 text-sm text-green-800/95 dark:text-green-200/90">
            {lastSaved.mealTag} · {savedLoggedAtDisplay}
          </p>
        </div>
        <button
          type="button"
          className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:bg-red-600 dark:hover:bg-red-500"
          onClick={() => {
            resetToFreshEntry();
            announce('Ready to add another food diary entry.', {
              politeness: 'polite',
            });
          }}
        >
          Add a new entry
        </button>
      </section>
    );
  }

  return (
    <section className="space-y-5 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-app-ink">
          {heading}
        </h2>
        <p className="mt-1 text-sm text-app-muted">{description}</p>
      </div>

      <div key={formInstanceKey} className="space-y-5">
        <fieldset className="space-y-2" disabled={saving}>
          <legend className="text-sm font-medium text-app-ink">Meal tag</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MEAL_TAGS.map((tag) => {
              const selected = mealTag === tag;
              return (
                <button
                  type="button"
                  key={tag}
                  aria-pressed={selected}
                  className={`flex min-h-[44px] items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg ${
                    selected
                      ? 'border-red-700 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100'
                      : 'cursor-pointer border-app-border bg-app-surface text-app-ink hover:bg-app-surface/80'
                  } ${saving ? 'cursor-not-allowed opacity-60' : ''}`}
                  disabled={saving}
                  onClick={() => {
                    if (!saving) {
                      setMealTag(selected ? null : tag);
                    }
                  }}
                >
                  {tag}
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="block space-y-1 text-sm font-medium text-app-ink">
          <span>Logged at</span>
          <input
            type="datetime-local"
            value={loggedAtLocal}
            disabled={saving}
            onChange={(e) => {
              setLoggedAtLocal(e.target.value);
            }}
            className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
          />
        </label>

        <label className="block space-y-1 text-sm font-medium text-app-ink">
          <span>Food note</span>
          <textarea
            rows={4}
            value={foodNote}
            disabled={saving}
            onChange={(e) => {
              setFoodNote(e.target.value);
            }}
            placeholder="What did you eat or drink?"
            className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
          />
        </label>
      </div>

      {errorMessage ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {!isStandalone && successMessage ? (
        <p className="text-sm text-green-700 dark:text-green-300" role="status">
          {successMessage}
        </p>
      ) : null}

      <button
        type="button"
        className="inline-flex min-h-[56px] w-full items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
        disabled={saving}
        onClick={() => {
          void onSubmit();
        }}
      >
        {saving ? 'Saving…' : submitLabel}
      </button>
    </section>
  );
}
