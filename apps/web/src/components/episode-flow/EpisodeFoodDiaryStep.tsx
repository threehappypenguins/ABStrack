'use client';

import { MEAL_TAGS } from '@abstrack/types';
import { EpisodeLocaleInstant } from '@/components/episodes/EpisodeLocaleInstant';
import { ConfirmDialog } from '../symptom-presets/ConfirmDialog';
import type { EpisodeFoodDiaryHookResult } from './use-episode-food-diary';

export type EpisodeFoodDiaryStepProps = {
  fd: EpisodeFoodDiaryHookResult;
  onBack: () => void;
  cancelDialogOpen: boolean;
  setCancelDialogOpen: (open: boolean) => void;
  onCancelEpisodeConfirm: () => void | false | Promise<void | false>;
  cancelingEpisode: boolean;
};

/**
 * Food diary step UI for the episode health-marker flow (list, add, edit, delete).
 * State and effects live in {@link useEpisodeFoodDiary}.
 */
export function EpisodeFoodDiaryStep({
  fd,
  onBack,
  cancelDialogOpen,
  setCancelDialogOpen,
  onCancelEpisodeConfirm,
  cancelingEpisode,
}: EpisodeFoodDiaryStepProps) {
  return (
    <>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-app-ink">
            Food diary
          </h1>
          <p className="mt-2 text-base text-app-muted">
            Add one or more meals/snacks for this episode, or skip this step.
          </p>
        </div>

        <section className="space-y-3 rounded-2xl border border-app-border/90 bg-app-surface p-5 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
          <h2 className="text-base font-semibold text-app-ink">
            Saved entries
          </h2>
          {fd.foodEntriesLoading ? (
            <p className="text-sm text-app-muted" role="status">
              Loading entries…
            </p>
          ) : null}
          {fd.foodEntriesError ? (
            <div className="space-y-2">
              <p
                className="text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {fd.foodEntriesError}
              </p>
              <button
                type="button"
                className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-app-border px-3 py-2 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60"
                disabled={fd.foodEntriesLoading}
                onClick={() => {
                  void fd.loadFoodEntries();
                }}
              >
                {fd.foodEntriesLoading ? 'Retrying…' : 'Try again'}
              </button>
            </div>
          ) : null}
          {!fd.foodEntriesLoading &&
          !fd.foodEntriesError &&
          fd.foodEntries.length === 0 ? (
            <p className="text-sm text-app-muted">
              No food entries yet for this episode.
            </p>
          ) : null}
          {!fd.foodEntriesLoading && fd.foodEntries.length > 0 ? (
            <div className="space-y-2">
              {fd.foodEntries.map((entry) => (
                <div
                  key={entry.id}
                  className="rounded-xl border border-app-border bg-app-surface px-3 py-3"
                >
                  <p className="text-sm font-semibold text-app-ink">
                    {entry.meal_tag} -{' '}
                    <EpisodeLocaleInstant iso={entry.logged_at} />
                  </p>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-app-muted">
                    {entry.food_note}
                  </p>
                  {fd.editingFoodEntryId === entry.id ? (
                    <div className="mt-3 space-y-3 rounded-lg border border-app-border/80 p-3">
                      <fieldset className="space-y-2" disabled={fd.foodSaving}>
                        <legend className="text-xs font-medium text-app-ink">
                          Meal tag
                        </legend>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                          {MEAL_TAGS.map((tag) => {
                            const selected = fd.foodMealTag === tag;
                            return (
                              <button
                                type="button"
                                key={`edit-${entry.id}-${tag}`}
                                aria-pressed={selected}
                                className={`flex min-h-[40px] items-center justify-center rounded-lg border px-3 py-2 text-xs font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                                  selected
                                    ? 'border-red-700 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100'
                                    : 'cursor-pointer border-app-border bg-app-surface text-app-ink hover:bg-app-surface/80'
                                }`}
                                disabled={fd.foodSaving}
                                onClick={() => {
                                  if (!fd.foodSaving) {
                                    fd.setFoodMealTag(selected ? null : tag);
                                  }
                                }}
                              >
                                {tag}
                              </button>
                            );
                          })}
                        </div>
                      </fieldset>
                      <label className="block space-y-1 text-xs font-medium text-app-ink">
                        <span>Logged at</span>
                        <input
                          type="datetime-local"
                          value={fd.foodLoggedAtLocal}
                          disabled={fd.foodSaving}
                          onChange={(e) => {
                            fd.setFoodLoggedAtLocal(e.target.value);
                          }}
                          className="min-h-[40px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                        />
                      </label>
                      <label className="block space-y-1 text-xs font-medium text-app-ink">
                        <span>Food note</span>
                        <textarea
                          rows={3}
                          value={fd.foodNote}
                          disabled={fd.foodSaving}
                          onChange={(e) => {
                            fd.setFoodNote(e.target.value);
                          }}
                          className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
                        />
                      </label>
                      {fd.foodSaveError ? (
                        <p
                          className="text-xs text-red-700 dark:text-red-300"
                          role="alert"
                        >
                          {fd.foodSaveError}
                        </p>
                      ) : null}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg bg-red-700 px-3 text-xs font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
                          disabled={fd.foodSaving}
                          onClick={() => {
                            void fd.onSaveFoodEntry();
                          }}
                        >
                          {fd.foodSaving ? 'Saving…' : 'Update'}
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-app-border px-3 text-xs font-semibold text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                          onClick={fd.resetFoodForm}
                        >
                          Discard changes
                        </button>
                        <button
                          type="button"
                          className="inline-flex min-h-[40px] items-center justify-center rounded-lg border border-red-400 px-3 text-xs font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-950/30"
                          disabled={fd.deletingFoodEntryId != null}
                          onClick={() => {
                            fd.requestDeleteFoodEntry(entry.id);
                          }}
                        >
                          {fd.deletingFoodEntryId === entry.id
                            ? 'Discarding…'
                            : 'Discard entry'}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {fd.editingFoodEntryId !== entry.id ? (
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-app-border px-3 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                        onClick={() => {
                          fd.onEditFoodEntry(entry);
                        }}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        className="inline-flex min-h-[36px] items-center justify-center rounded-lg border border-red-400 px-3 text-sm font-medium text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-950/30"
                        disabled={fd.deletingFoodEntryId != null}
                        onClick={() => {
                          fd.requestDeleteFoodEntry(entry.id);
                        }}
                      >
                        {fd.deletingFoodEntryId === entry.id
                          ? 'Discarding…'
                          : 'Discard entry'}
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </section>

        {fd.editingFoodEntryId == null && fd.isAddFoodEntryOpen ? (
          <section className="space-y-4 rounded-2xl border border-app-border/90 bg-app-surface p-5 shadow-soft ring-1 ring-[color:var(--app-ring-slate)]">
            <h2 className="text-base font-semibold text-app-ink">
              Add food entry
            </h2>
            <fieldset className="space-y-2" disabled={fd.foodSaving}>
              <legend className="text-sm font-medium text-app-ink">
                Meal tag
              </legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {MEAL_TAGS.map((tag) => {
                  const selected = fd.foodMealTag === tag;
                  return (
                    <button
                      type="button"
                      key={`add-${tag}`}
                      aria-pressed={selected}
                      className={`flex min-h-[44px] items-center justify-center rounded-lg border px-3 py-2 text-sm font-medium shadow-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 ${
                        selected
                          ? 'border-red-700 bg-red-50 text-red-900 dark:border-red-500 dark:bg-red-950/40 dark:text-red-100'
                          : 'cursor-pointer border-app-border bg-app-surface text-app-ink hover:bg-app-surface/80'
                      }`}
                      disabled={fd.foodSaving}
                      onClick={() => {
                        if (!fd.foodSaving) {
                          const nextMealTag = selected ? null : tag;
                          fd.setFoodMealTag(nextMealTag);
                          fd.setIsAddFoodEntryDirty(
                            fd.computeIsAddFoodEntryDirty({
                              mealTag: nextMealTag,
                              note: fd.foodNote,
                              loggedAtLocal: fd.foodLoggedAtLocal,
                            }),
                          );
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
                value={fd.foodLoggedAtLocal}
                disabled={fd.foodSaving}
                onChange={(e) => {
                  const nextLoggedAtLocal = e.target.value;
                  fd.setFoodLoggedAtLocal(nextLoggedAtLocal);
                  fd.setIsAddFoodEntryDirty(
                    fd.computeIsAddFoodEntryDirty({
                      mealTag: fd.foodMealTag,
                      note: fd.foodNote,
                      loggedAtLocal: nextLoggedAtLocal,
                    }),
                  );
                }}
                className="min-h-[44px] w-full rounded-lg border border-app-border bg-app-surface px-3 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
              />
            </label>
            <label className="block space-y-1 text-sm font-medium text-app-ink">
              <span>Food note</span>
              <textarea
                rows={3}
                value={fd.foodNote}
                disabled={fd.foodSaving}
                onChange={(e) => {
                  const nextFoodNote = e.target.value;
                  fd.setFoodNote(nextFoodNote);
                  fd.setIsAddFoodEntryDirty(
                    fd.computeIsAddFoodEntryDirty({
                      mealTag: fd.foodMealTag,
                      note: nextFoodNote,
                      loggedAtLocal: fd.foodLoggedAtLocal,
                    }),
                  );
                }}
                placeholder="What did you eat or drink?"
                className="w-full rounded-lg border border-app-border bg-app-surface px-3 py-2 text-app-ink outline-none focus-visible:ring-2 focus-visible:ring-app-ring"
              />
            </label>
            {fd.foodSaveError ? (
              <p
                className="text-sm text-red-700 dark:text-red-300"
                role="alert"
              >
                {fd.foodSaveError}
              </p>
            ) : null}
            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="inline-flex min-h-[48px] items-center justify-center rounded-xl bg-red-700 px-4 text-sm font-semibold text-white shadow-md transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
                disabled={fd.foodSaving}
                onClick={() => {
                  void fd.onSaveFoodEntry();
                }}
              >
                {fd.foodSaving ? 'Saving…' : 'Save entry'}
              </button>
              {fd.isAddFoodEntryDirty ? (
                <button
                  type="button"
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-red-400 px-4 text-sm font-semibold text-red-700 transition hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg dark:border-red-500/60 dark:text-red-300 dark:hover:bg-red-950/30"
                  onClick={fd.onDiscardAddFoodDraft}
                >
                  Discard entry
                </button>
              ) : null}
              {!fd.isAddFoodEntryDirty ? (
                <button
                  type="button"
                  className="inline-flex min-h-[48px] items-center justify-center rounded-xl border border-app-border px-4 text-sm font-semibold text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
                  onClick={() => {
                    fd.setIsAddFoodEntryOpen(false);
                  }}
                >
                  Collapse
                </button>
              ) : null}
            </div>
          </section>
        ) : null}

        <div
          className={`flex flex-wrap items-center gap-3 ${
            fd.editingFoodEntryId == null && !fd.isAddFoodEntryOpen
              ? 'mt-6'
              : 'mt-3'
          }`}
        >
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-app-border px-3 py-2 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
            onClick={onBack}
          >
            Back
          </button>
          {fd.editingFoodEntryId == null && !fd.isAddFoodEntryOpen ? (
            <button
              type="button"
              className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-app-border px-3 py-2 text-sm font-medium text-app-ink transition hover:bg-app-surface/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg"
              onClick={() => {
                fd.resetFoodForm();
                fd.setIsAddFoodEntryOpen(true);
              }}
            >
              Add food entry
            </button>
          ) : null}
          <button
            type="button"
            className="inline-flex min-h-[44px] items-center justify-center rounded-lg bg-red-700 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-red-800 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-app-ring focus-visible:ring-offset-2 focus-visible:ring-offset-app-bg disabled:cursor-not-allowed disabled:opacity-60 dark:bg-red-600 dark:hover:bg-red-500"
            onClick={fd.onContinueFromFoodDiary}
            disabled={
              fd.foodSaving ||
              fd.deletingFoodEntryId != null ||
              fd.foodEntriesLoading
            }
          >
            {fd.foodEntries.length > 0 ? 'Continue' : 'Skip for now'}
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
      <ConfirmDialog
        open={fd.discardAddFoodDraftDialogOpen}
        title="Discard this food entry draft?"
        description="Your unsaved entry will be removed."
        confirmLabel="Discard draft"
        cancelLabel="Keep editing"
        onConfirm={fd.onConfirmDiscardAddFoodDraft}
        onClose={() => {
          fd.setDiscardAddFoodDraftDialogOpen(false);
        }}
      />
      <ConfirmDialog
        open={fd.foodEntryDeleteConfirmEntryId != null}
        title="Discard this saved food entry?"
        description="This cannot be undone."
        confirmLabel="Discard entry"
        confirmBusyLabel="Discarding…"
        cancelLabel="Keep entry"
        onConfirm={fd.onConfirmDeleteFoodEntry}
        onClose={() => {
          fd.setFoodEntryDeleteConfirmEntryId(null);
        }}
      />
    </>
  );
}
