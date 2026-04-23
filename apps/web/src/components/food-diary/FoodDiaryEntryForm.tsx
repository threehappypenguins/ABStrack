'use client';

import { useMemo, useState } from 'react';
import type { MealTag } from '@abstrack/types';
import { MEAL_TAGS } from '@abstrack/types';
import { createFoodDiaryEntry } from '@abstrack/supabase';
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

/**
 * Food diary entry form used from home and episode-end flow.
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
  const [mealTag, setMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const [loggedAtLocal, setLoggedAtLocal] = useState(() =>
    toLocalDateTimeInputValue(new Date().toISOString()),
  );
  const [saving, setSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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
      user_id: user.id,
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

    setSuccessMessage(
      episodeId
        ? 'Food entry saved and linked to this episode.'
        : 'Food entry saved.',
    );
    setFoodNote('');
    setLoggedAtLocal(toLocalDateTimeInputValue(new Date().toISOString()));
    announce('Food entry saved.', { politeness: 'polite' });
    onSaved?.();
  };

  return (
    <section className="space-y-5 rounded-2xl border border-app-border/90 bg-app-surface p-6 shadow-soft ring-1 ring-[color:var(--app-ring-slate)] sm:p-8">
      <div>
        <h2 className="text-xl font-semibold tracking-tight text-app-ink">
          {heading}
        </h2>
        <p className="mt-1 text-sm text-app-muted">{description}</p>
      </div>

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

      {errorMessage ? (
        <p className="text-sm text-red-700 dark:text-red-300" role="alert">
          {errorMessage}
        </p>
      ) : null}
      {successMessage ? (
        <p className="text-sm text-green-700 dark:text-green-300" role="status">
          {successMessage}
        </p>
      ) : null}

      <button
        type="button"
        className="inline-flex min-h-[56px] items-center justify-center rounded-xl bg-red-700 px-5 text-base font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
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
