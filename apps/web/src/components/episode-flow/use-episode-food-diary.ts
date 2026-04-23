'use client';

import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FoodDiaryEntryRow, MealTag } from '@abstrack/types';
import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import {
  createFoodDiaryEntry,
  deleteFoodDiaryEntry,
  listFoodDiaryEntriesForEpisode,
  updateFoodDiaryEntry,
} from '@abstrack/supabase';
import {
  localInputValueToIso,
  toLocalDateTimeInputValue,
} from '@/lib/food-diary/date-time';

/** Same ordering as `listFoodDiaryEntriesForEpisode` (newest first). */
function compareFoodDiaryEntriesDesc(
  a: FoodDiaryEntryRow,
  b: FoodDiaryEntryRow,
): number {
  let c = b.logged_at.localeCompare(a.logged_at);
  if (c !== 0) {
    return c;
  }
  c = b.created_at.localeCompare(a.created_at);
  if (c !== 0) {
    return c;
  }
  return b.id.localeCompare(a.id);
}

function upsertFoodEntrySorted(
  prev: FoodDiaryEntryRow[],
  row: FoodDiaryEntryRow,
): FoodDiaryEntryRow[] {
  const next = prev.filter((e) => e.id !== row.id);
  next.push(row);
  next.sort(compareFoodDiaryEntriesDesc);
  return next;
}

type AnnouncePoliteness = 'polite' | 'assertive';

export type EpisodeFoodDiaryAnnounce = (
  message: string,
  options?: { politeness: AnnouncePoliteness },
) => void;

export type UseEpisodeFoodDiaryArgs = {
  episodeId: string;
  userId: string | null;
  supabase: AbstrackSupabaseClient;
  announce: EpisodeFoodDiaryAnnounce;
  /** When true, loads entries on mount and when this flips to true. */
  enabled: boolean;
  /** Called after user taps Continue / Skip with how saved entries should be summarized. */
  onLeaveFoodDiary: (decision: 'saved' | 'skipped') => void;
};

export type EpisodeFoodDiaryHookResult = {
  reset: () => void;
  foodEntries: FoodDiaryEntryRow[];
  foodEntriesLoading: boolean;
  foodEntriesError: string | null;
  foodMealTag: MealTag | null;
  setFoodMealTag: Dispatch<SetStateAction<MealTag | null>>;
  foodNote: string;
  setFoodNote: Dispatch<SetStateAction<string>>;
  foodLoggedAtLocal: string;
  setFoodLoggedAtLocal: Dispatch<SetStateAction<string>>;
  foodSaving: boolean;
  foodSaveError: string | null;
  editingFoodEntryId: string | null;
  deletingFoodEntryId: string | null;
  isAddFoodEntryOpen: boolean;
  setIsAddFoodEntryOpen: Dispatch<SetStateAction<boolean>>;
  isAddFoodEntryDirty: boolean;
  setIsAddFoodEntryDirty: Dispatch<SetStateAction<boolean>>;
  discardAddFoodDraftDialogOpen: boolean;
  setDiscardAddFoodDraftDialogOpen: Dispatch<SetStateAction<boolean>>;
  foodEntryDeleteConfirmEntryId: string | null;
  setFoodEntryDeleteConfirmEntryId: Dispatch<SetStateAction<string | null>>;
  computeIsAddFoodEntryDirty: (next: {
    mealTag: MealTag | null;
    note: string;
    loggedAtLocal: string;
  }) => boolean;
  resetFoodForm: () => void;
  loadFoodEntries: () => Promise<void>;
  onDiscardAddFoodDraft: () => void;
  onConfirmDiscardAddFoodDraft: () => void;
  onEditFoodEntry: (entry: FoodDiaryEntryRow) => void;
  onSaveFoodEntry: () => Promise<void>;
  requestDeleteFoodEntry: (entryId: string) => void;
  onConfirmDeleteFoodEntry: () => Promise<void | false>;
  onContinueFromFoodDiary: () => void;
};

/**
 * Food diary list / add / edit / delete for the episode health-marker flow.
 * Keeps loading, dirty tracking, and confirm dialogs out of the parent stepper.
 */
export function useEpisodeFoodDiary({
  episodeId,
  userId,
  supabase,
  announce,
  enabled,
  onLeaveFoodDiary,
}: UseEpisodeFoodDiaryArgs): EpisodeFoodDiaryHookResult {
  const [foodEntries, setFoodEntries] = useState<FoodDiaryEntryRow[]>([]);
  const [foodEntriesLoading, setFoodEntriesLoading] = useState(false);
  const [foodEntriesError, setFoodEntriesError] = useState<string | null>(null);
  const [foodMealTag, setFoodMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const initialFoodLoggedAtLocalRef = useRef(
    toLocalDateTimeInputValue(new Date().toISOString()),
  );
  const [foodLoggedAtLocal, setFoodLoggedAtLocal] = useState(
    initialFoodLoggedAtLocalRef.current,
  );
  const [addFoodInitialLoggedAtLocal, setAddFoodInitialLoggedAtLocal] =
    useState(initialFoodLoggedAtLocalRef.current);
  const [foodSaving, setFoodSaving] = useState(false);
  const [foodSaveError, setFoodSaveError] = useState<string | null>(null);
  const [editingFoodEntryId, setEditingFoodEntryId] = useState<string | null>(
    null,
  );
  const [deletingFoodEntryId, setDeletingFoodEntryId] = useState<string | null>(
    null,
  );
  const [isAddFoodEntryOpen, setIsAddFoodEntryOpen] = useState(true);
  const [isAddFoodEntryDirty, setIsAddFoodEntryDirty] = useState(false);
  const [discardAddFoodDraftDialogOpen, setDiscardAddFoodDraftDialogOpen] =
    useState(false);
  const [foodEntryDeleteConfirmEntryId, setFoodEntryDeleteConfirmEntryId] =
    useState<string | null>(null);

  const resetFoodForm = useCallback(() => {
    const initialFoodLoggedAtLocal = toLocalDateTimeInputValue(
      new Date().toISOString(),
    );
    setEditingFoodEntryId(null);
    setFoodMealTag(null);
    setFoodNote('');
    setFoodLoggedAtLocal(initialFoodLoggedAtLocal);
    setAddFoodInitialLoggedAtLocal(initialFoodLoggedAtLocal);
    setFoodSaveError(null);
    setIsAddFoodEntryDirty(false);
  }, []);

  const reset = useCallback(() => {
    setFoodEntries([]);
    setFoodEntriesError(null);
    setFoodEntriesLoading(false);
    setFoodMealTag(null);
    setFoodNote('');
    const initialFoodLoggedAtLocal = toLocalDateTimeInputValue(
      new Date().toISOString(),
    );
    setFoodLoggedAtLocal(initialFoodLoggedAtLocal);
    setAddFoodInitialLoggedAtLocal(initialFoodLoggedAtLocal);
    setFoodSaving(false);
    setFoodSaveError(null);
    setEditingFoodEntryId(null);
    setDeletingFoodEntryId(null);
    setDiscardAddFoodDraftDialogOpen(false);
    setFoodEntryDeleteConfirmEntryId(null);
    setIsAddFoodEntryOpen(true);
    setIsAddFoodEntryDirty(false);
  }, []);

  const computeIsAddFoodEntryDirty = useCallback(
    (next: {
      mealTag: MealTag | null;
      note: string;
      loggedAtLocal: string;
    }) => {
      return (
        next.mealTag != null ||
        next.note.trim().length > 0 ||
        next.loggedAtLocal !== addFoodInitialLoggedAtLocal
      );
    },
    [addFoodInitialLoggedAtLocal],
  );

  const onDiscardAddFoodDraft = useCallback(() => {
    if (!isAddFoodEntryDirty) {
      setIsAddFoodEntryOpen(false);
      return;
    }
    setDiscardAddFoodDraftDialogOpen(true);
  }, [isAddFoodEntryDirty]);

  const onConfirmDiscardAddFoodDraft = useCallback(() => {
    resetFoodForm();
    setIsAddFoodEntryOpen(false);
  }, [resetFoodForm]);

  const loadFoodEntries = useCallback(async () => {
    setFoodEntriesLoading(true);
    setFoodEntriesError(null);
    const result = await listFoodDiaryEntriesForEpisode(supabase, episodeId);
    setFoodEntriesLoading(false);
    if (!result.ok) {
      setFoodEntriesError(result.error.message);
      return;
    }
    setFoodEntries(result.data);
  }, [episodeId, supabase]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadFoodEntries();
  }, [enabled, loadFoodEntries]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    // Hook mounts before the food-diary step; refresh default logged-at when entering
    // so it matches "now" after time on health markers (skip in-flight add/edit).
    if (editingFoodEntryId != null || isAddFoodEntryDirty) {
      return;
    }
    const nowLocal = toLocalDateTimeInputValue(new Date().toISOString());
    initialFoodLoggedAtLocalRef.current = nowLocal;
    setFoodLoggedAtLocal(nowLocal);
    setAddFoodInitialLoggedAtLocal(nowLocal);
  }, [enabled, editingFoodEntryId, isAddFoodEntryDirty]);

  const onEditFoodEntry = useCallback((entry: FoodDiaryEntryRow) => {
    setEditingFoodEntryId(entry.id);
    setIsAddFoodEntryOpen(false);
    setFoodMealTag(entry.meal_tag);
    setFoodNote(entry.food_note);
    setFoodLoggedAtLocal(toLocalDateTimeInputValue(entry.logged_at));
    setFoodSaveError(null);
  }, []);

  const onSaveFoodEntry = useCallback(async () => {
    if (foodSaving || !userId) {
      return;
    }
    setFoodSaving(true);
    setFoodSaveError(null);
    if (!foodMealTag) {
      const message = 'Choose a meal tag.';
      setFoodSaveError(message);
      announce(message, { politeness: 'assertive' });
      setFoodSaving(false);
      return;
    }
    const loggedAtIso = localInputValueToIso(foodLoggedAtLocal);
    if (!loggedAtIso) {
      const message = 'Enter a valid date and time.';
      setFoodSaveError(message);
      announce(message, { politeness: 'assertive' });
      setFoodSaving(false);
      return;
    }

    const editingId = editingFoodEntryId;
    const result =
      editingId == null
        ? await createFoodDiaryEntry(supabase, {
            user_id: userId,
            episode_id: episodeId,
            meal_tag: foodMealTag,
            food_note: foodNote,
            logged_at: loggedAtIso,
          })
        : await updateFoodDiaryEntry(supabase, editingId, {
            meal_tag: foodMealTag,
            food_note: foodNote,
            logged_at: loggedAtIso,
          });
    setFoodSaving(false);
    if (!result.ok) {
      setFoodSaveError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    setFoodEntries((prev) => upsertFoodEntrySorted(prev, result.data));
    await loadFoodEntries();
    resetFoodForm();
    if (editingId == null) {
      setIsAddFoodEntryOpen(false);
    }
    announce(editingId == null ? 'Food entry saved.' : 'Food entry updated.', {
      politeness: 'polite',
    });
  }, [
    announce,
    editingFoodEntryId,
    episodeId,
    foodLoggedAtLocal,
    foodMealTag,
    foodNote,
    foodSaving,
    loadFoodEntries,
    resetFoodForm,
    supabase,
    userId,
  ]);

  const requestDeleteFoodEntry = useCallback(
    (entryId: string) => {
      if (foodSaving || deletingFoodEntryId) {
        return;
      }
      setFoodEntryDeleteConfirmEntryId(entryId);
    },
    [deletingFoodEntryId, foodSaving],
  );

  const onConfirmDeleteFoodEntry = useCallback(async () => {
    const entryId = foodEntryDeleteConfirmEntryId;
    if (!entryId || foodSaving || deletingFoodEntryId) {
      return false;
    }
    setDeletingFoodEntryId(entryId);
    setFoodSaveError(null);
    const result = await deleteFoodDiaryEntry(supabase, entryId);
    setDeletingFoodEntryId(null);
    if (!result.ok) {
      setFoodSaveError(result.error.message);
      announce(result.error.message, { politeness: 'assertive' });
      return false;
    }
    if (editingFoodEntryId === entryId) {
      resetFoodForm();
    }
    await loadFoodEntries();
    announce('Food entry discarded.', { politeness: 'polite' });
    return;
  }, [
    announce,
    deletingFoodEntryId,
    editingFoodEntryId,
    foodEntryDeleteConfirmEntryId,
    foodSaving,
    loadFoodEntries,
    resetFoodForm,
    supabase,
  ]);

  const onContinueFromFoodDiary = useCallback(() => {
    if (foodSaving || deletingFoodEntryId != null || foodEntriesLoading) {
      return;
    }
    onLeaveFoodDiary(foodEntries.length > 0 ? 'saved' : 'skipped');
  }, [
    deletingFoodEntryId,
    foodEntries.length,
    foodEntriesLoading,
    foodSaving,
    onLeaveFoodDiary,
  ]);

  return {
    reset,
    foodEntries,
    foodEntriesLoading,
    foodEntriesError,
    foodMealTag,
    setFoodMealTag,
    foodNote,
    setFoodNote,
    foodLoggedAtLocal,
    setFoodLoggedAtLocal,
    foodSaving,
    foodSaveError,
    editingFoodEntryId,
    deletingFoodEntryId,
    isAddFoodEntryOpen,
    setIsAddFoodEntryOpen,
    isAddFoodEntryDirty,
    setIsAddFoodEntryDirty,
    discardAddFoodDraftDialogOpen,
    setDiscardAddFoodDraftDialogOpen,
    foodEntryDeleteConfirmEntryId,
    setFoodEntryDeleteConfirmEntryId,
    computeIsAddFoodEntryDirty,
    resetFoodForm,
    loadFoodEntries,
    onDiscardAddFoodDraft,
    onConfirmDiscardAddFoodDraft,
    onEditFoodEntry,
    onSaveFoodEntry,
    requestDeleteFoodEntry,
    onConfirmDeleteFoodEntry,
    onContinueFromFoodDiary,
  };
}
