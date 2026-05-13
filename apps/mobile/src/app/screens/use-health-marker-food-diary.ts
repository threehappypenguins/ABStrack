import type { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import type { Dispatch, SetStateAction } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Platform } from 'react-native';
import type { FoodDiaryEntryRow, MealTag } from '@abstrack/types';
import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';
import { announce } from '@abstrack/ui/native';
import {
  createFoodDiaryEntryOfflineFirst,
  deleteFoodDiaryEntryOfflineFirst,
  listFoodDiaryEntriesForEpisodeOfflineFirst,
  updateFoodDiaryEntryOfflineFirst,
} from '../../lib/episodes/mobile-offline-first-gateway';
import {
  currentLocalDate,
  currentLocalTime,
  isoToLocalDate,
  isoToLocalTime,
  localDateFromDate,
  localDateTimeToIso,
  localTimeFromDate,
} from '../../lib/food-diary/date-time';
import { resolveMobilePhiSubjectUserContext } from '../../lib/phi-subject/resolve-mobile-phi-subject-user-context';
import { getMobileAuthSessionSafe } from '../../lib/supabase-wiring';

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

export type UseHealthMarkerFoodDiaryArgs = {
  episodeId: string;
  supabase: AbstrackSupabaseClient;
  /** When set (PowerSync replica ready), food diary CRUD uses local SQLite + upload queue. */
  powerSyncDatabase?: PowerSyncDatabase | null;
  /**
   * When true (caller should align with `powerSyncOfflineReplicaReadsEnabled` on the session bridge),
   * an empty local PowerSync list skips Supabase verification so legitimately empty episodes work offline
   * without a redundant remote read. When false, empty local still requires a successful verification
   * read so an initialized-but-not-yet-synced replica cannot mask server rows on a cold offline open.
   */
  trustEmptyLocalFoodDiaryList?: boolean;
  enabled: boolean;
  onLeaveFoodDiary: (decision: 'saved' | 'skipped') => void | Promise<void>;
  onBack: () => void | Promise<void>;
};

export type HealthMarkerFoodDiaryHookResult = {
  reset: () => void;
  mealTag: MealTag | null;
  setMealTag: Dispatch<SetStateAction<MealTag | null>>;
  foodNote: string;
  setFoodNote: Dispatch<SetStateAction<string>>;
  foodLoggedDate: string;
  setFoodLoggedDate: Dispatch<SetStateAction<string>>;
  foodLoggedTime: string;
  setFoodLoggedTime: Dispatch<SetStateAction<string>>;
  foodEntries: FoodDiaryEntryRow[];
  foodEntriesLoading: boolean;
  foodEntriesError: string | null;
  savingFoodDiary: boolean;
  foodDiaryFeedback: string | null;
  editingFoodEntryId: string | null;
  deletingFoodEntryId: string | null;
  isAddFoodEntryOpen: boolean;
  setIsAddFoodEntryOpen: Dispatch<SetStateAction<boolean>>;
  isAddFoodEntryDirty: boolean;
  setIsAddFoodEntryDirty: Dispatch<SetStateAction<boolean>>;
  foodDatePickerOpen: boolean;
  setFoodDatePickerOpen: Dispatch<SetStateAction<boolean>>;
  foodTimePickerOpen: boolean;
  setFoodTimePickerOpen: Dispatch<SetStateAction<boolean>>;
  foodDiaryContinueDisabled: boolean;
  foodLoggedDateTimeValue: Date;
  foodLoggedDateLabel: string;
  foodLoggedTimeLabel: string;
  computeIsAddFoodEntryDirty: (next: {
    mealTag: MealTag | null;
    foodNote: string;
    foodLoggedDate: string;
    foodLoggedTime: string;
  }) => boolean;
  loadFoodEntries: () => Promise<void>;
  onSaveFoodDiary: () => Promise<void>;
  onContinueFromFoodDiary: () => Promise<void>;
  onBackFromFoodDiary: () => Promise<void>;
  onEditFoodEntry: (entry: FoodDiaryEntryRow) => void;
  onNewFoodEntry: () => void;
  onDiscardFoodEditChanges: () => void;
  onDiscardAddFoodDraft: () => void;
  onFoodDatePickerChange: (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => void;
  onFoodTimePickerChange: (
    event: DateTimePickerEvent,
    selectedDate?: Date,
  ) => void;
  onDeleteFoodEntry: (entryId: string) => void;
};

/**
 * Food diary list / add / edit / delete for the in-episode health marker flow (mobile).
 *
 * **Creates:** {@link onSaveFoodDiary} resolves {@link resolveMobilePhiSubjectUserContext} for **new**
 * entries and passes that patient-scope `user_id` into offline-first creates — queued SQLite writes have no RLS, so a
 * caller-supplied id from mount would be unsafe across sign-out / account switches (same pattern as
 * symptom persists on {@link SymptomPromptScreen}). When resolve returns `{ ok: true, data: null }`
 * (replica cannot determine PHI scope yet, e.g. offline before `profiles` / `caretaker_access` sync),
 * signed-in users see a **scope / sync** message, not a sign-in error.
 * **Edits** skip that session check and call
 * {@link updateFoodDiaryEntryOfflineFirst} by row id only so local updates still apply when persisted-session
 * recovery fails after sync.
 */
export function useHealthMarkerFoodDiary({
  episodeId,
  supabase,
  powerSyncDatabase = null,
  trustEmptyLocalFoodDiaryList = false,
  enabled,
  onLeaveFoodDiary,
  onBack,
}: UseHealthMarkerFoodDiaryArgs): HealthMarkerFoodDiaryHookResult {
  const initialFoodDateTimeRef = useRef({
    date: currentLocalDate(),
    time: currentLocalTime(),
  });
  const [mealTag, setMealTag] = useState<MealTag | null>(null);
  const [foodNote, setFoodNote] = useState('');
  const [foodLoggedDate, setFoodLoggedDate] = useState(
    initialFoodDateTimeRef.current.date,
  );
  const [foodLoggedTime, setFoodLoggedTime] = useState(
    initialFoodDateTimeRef.current.time,
  );
  const [addFoodInitialDate, setAddFoodInitialDate] = useState(
    initialFoodDateTimeRef.current.date,
  );
  const [addFoodInitialTime, setAddFoodInitialTime] = useState(
    initialFoodDateTimeRef.current.time,
  );
  const [foodEntries, setFoodEntries] = useState<FoodDiaryEntryRow[]>([]);
  const [foodEntriesLoading, setFoodEntriesLoading] = useState(false);
  const [foodEntriesError, setFoodEntriesError] = useState<string | null>(null);
  const [savingFoodDiary, setSavingFoodDiary] = useState(false);
  const [foodDiaryFeedback, setFoodDiaryFeedback] = useState<string | null>(
    null,
  );
  const [editingFoodEntryId, setEditingFoodEntryId] = useState<string | null>(
    null,
  );
  const [deletingFoodEntryId, setDeletingFoodEntryId] = useState<string | null>(
    null,
  );
  const [isAddFoodEntryOpen, setIsAddFoodEntryOpen] = useState(false);
  const [isAddFoodEntryDirty, setIsAddFoodEntryDirty] = useState(false);
  const [foodDatePickerOpen, setFoodDatePickerOpen] = useState(false);
  const [foodTimePickerOpen, setFoodTimePickerOpen] = useState(false);

  const reset = useCallback(() => {
    const initialFoodDate = currentLocalDate();
    const initialFoodTime = currentLocalTime();
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(initialFoodDate);
    setFoodLoggedTime(initialFoodTime);
    setAddFoodInitialDate(initialFoodDate);
    setAddFoodInitialTime(initialFoodTime);
    setFoodEntries([]);
    setFoodEntriesLoading(false);
    setFoodEntriesError(null);
    setSavingFoodDiary(false);
    setFoodDiaryFeedback(null);
    setEditingFoodEntryId(null);
    setDeletingFoodEntryId(null);
    setIsAddFoodEntryOpen(false);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    // Hook mounts before the food-diary phase; refresh "now" when entering the step
    // so defaults are not stale after time on health markers (skip in-flight add/edit).
    if (editingFoodEntryId != null || isAddFoodEntryDirty) {
      return;
    }
    const d = currentLocalDate();
    const t = currentLocalTime();
    initialFoodDateTimeRef.current = { date: d, time: t };
    setFoodLoggedDate(d);
    setFoodLoggedTime(t);
    setAddFoodInitialDate(d);
    setAddFoodInitialTime(t);
  }, [enabled, editingFoodEntryId, isAddFoodEntryDirty]);

  const computeIsAddFoodEntryDirty = useCallback(
    (next: {
      mealTag: MealTag | null;
      foodNote: string;
      foodLoggedDate: string;
      foodLoggedTime: string;
    }) => {
      return (
        next.mealTag != null ||
        next.foodNote.trim().length > 0 ||
        next.foodLoggedDate !== addFoodInitialDate ||
        next.foodLoggedTime !== addFoodInitialTime
      );
    },
    [addFoodInitialDate, addFoodInitialTime],
  );

  const onNewFoodEntry = useCallback(() => {
    setEditingFoodEntryId(null);
    const initialFoodDate = currentLocalDate();
    const initialFoodTime = currentLocalTime();
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(initialFoodDate);
    setFoodLoggedTime(initialFoodTime);
    setAddFoodInitialDate(initialFoodDate);
    setAddFoodInitialTime(initialFoodTime);
    setFoodDiaryFeedback(null);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setIsAddFoodEntryOpen(true);
  }, []);

  const loadFoodEntries = useCallback(async () => {
    setFoodEntriesLoading(true);
    setFoodEntriesError(null);
    const result = await listFoodDiaryEntriesForEpisodeOfflineFirst(
      supabase,
      powerSyncDatabase,
      episodeId,
      { trustEmptyLocalReplica: trustEmptyLocalFoodDiaryList },
    );
    setFoodEntriesLoading(false);
    if (!result.ok) {
      setFoodEntriesError(result.error.message);
      return;
    }
    setFoodEntries(result.data);
  }, [episodeId, powerSyncDatabase, supabase, trustEmptyLocalFoodDiaryList]);

  useEffect(() => {
    if (!enabled) {
      return;
    }
    void loadFoodEntries();
  }, [enabled, loadFoodEntries]);

  const onEditFoodEntry = useCallback((entry: FoodDiaryEntryRow) => {
    setEditingFoodEntryId(entry.id);
    setIsAddFoodEntryOpen(false);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setMealTag(entry.meal_tag);
    setFoodNote(entry.food_note);
    setFoodLoggedDate(isoToLocalDate(entry.logged_at));
    setFoodLoggedTime(isoToLocalTime(entry.logged_at));
    setFoodDiaryFeedback(null);
  }, []);

  const onDiscardFoodEditChanges = useCallback(() => {
    setEditingFoodEntryId(null);
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(currentLocalDate());
    setFoodLoggedTime(currentLocalTime());
    setFoodDiaryFeedback(null);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setIsAddFoodEntryOpen(false);
  }, []);

  const onSaveFoodDiary = useCallback(async () => {
    if (savingFoodDiary) {
      return;
    }
    setSavingFoodDiary(true);
    setFoodDiaryFeedback(null);
    if (!mealTag) {
      const message = 'Choose a meal tag.';
      setFoodDiaryFeedback(message);
      await announce(message, { politeness: 'assertive' });
      setSavingFoodDiary(false);
      return;
    }
    const loggedAtIso = localDateTimeToIso(foodLoggedDate, foodLoggedTime);
    if (!loggedAtIso) {
      const message = 'Enter a valid date and time.';
      setFoodDiaryFeedback(message);
      await announce(message, { politeness: 'assertive' });
      setSavingFoodDiary(false);
      return;
    }

    const editingId = editingFoodEntryId;
    const useCurrentTimestampForDefaultAdd =
      editingId == null &&
      foodLoggedDate === addFoodInitialDate &&
      foodLoggedTime === addFoodInitialTime;
    const createLoggedAtIso = useCurrentTimestampForDefaultAdd
      ? new Date().toISOString()
      : loggedAtIso;

    let result;
    if (editingId != null) {
      result = await updateFoodDiaryEntryOfflineFirst(
        supabase,
        powerSyncDatabase,
        editingId,
        {
          meal_tag: mealTag,
          food_note: foodNote,
          logged_at: loggedAtIso,
        },
      );
    } else {
      const phiRes = await resolveMobilePhiSubjectUserContext({
        powerSyncDatabase,
      });
      if (!phiRes.ok) {
        const message = phiRes.error.message;
        setSavingFoodDiary(false);
        setFoodDiaryFeedback(message);
        await announce(message, { politeness: 'assertive' });
        return;
      }
      if (phiRes.data == null) {
        const {
          data: { session },
        } = await getMobileAuthSessionSafe();
        const message =
          session?.user?.id != null
            ? 'Patient scope is not ready on this device yet. Connect once while online or wait for sync, then try again.'
            : 'Your session could not be verified. Try signing in again.';
        setSavingFoodDiary(false);
        setFoodDiaryFeedback(message);
        await announce(message, { politeness: 'assertive' });
        return;
      }
      const userId = phiRes.data.phiSubjectUserId;
      result = await createFoodDiaryEntryOfflineFirst(
        supabase,
        powerSyncDatabase,
        {
          user_id: userId,
          episode_id: episodeId,
          meal_tag: mealTag,
          food_note: foodNote,
          logged_at: createLoggedAtIso,
        },
      );
    }
    if (!result.ok) {
      setSavingFoodDiary(false);
      setFoodDiaryFeedback(result.error.message);
      await announce(result.error.message, { politeness: 'assertive' });
      return;
    }
    setFoodEntries((prev) => upsertFoodEntrySorted(prev, result.data));
    setFoodEntriesError(null);
    const initialFoodDate = currentLocalDate();
    const initialFoodTime = currentLocalTime();
    setMealTag(null);
    setFoodNote('');
    setFoodLoggedDate(initialFoodDate);
    setFoodLoggedTime(initialFoodTime);
    setAddFoodInitialDate(initialFoodDate);
    setAddFoodInitialTime(initialFoodTime);
    setEditingFoodEntryId(null);
    setIsAddFoodEntryDirty(false);
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    if (editingId == null) {
      setIsAddFoodEntryOpen(false);
    }
    setFoodDiaryFeedback(null);
    await announce(
      editingId == null ? 'Food entry saved.' : 'Food entry updated.',
      { politeness: 'polite' },
    );
    setSavingFoodDiary(false);
  }, [
    editingFoodEntryId,
    episodeId,
    foodLoggedDate,
    foodLoggedTime,
    foodNote,
    mealTag,
    powerSyncDatabase,
    savingFoodDiary,
    supabase,
    addFoodInitialDate,
    addFoodInitialTime,
  ]);

  const foodDiaryContinueDisabled =
    savingFoodDiary || deletingFoodEntryId != null || foodEntriesLoading;

  const onContinueFromFoodDiary = useCallback(async () => {
    if (foodDiaryContinueDisabled) {
      return;
    }
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    const decision = foodEntries.length > 0 ? 'saved' : 'skipped';
    setFoodDiaryFeedback(null);
    await onLeaveFoodDiary(decision);
    await announce('Continue to episode details.', {
      politeness: 'polite',
    });
  }, [foodDiaryContinueDisabled, foodEntries.length, onLeaveFoodDiary]);

  const onBackFromFoodDiary = useCallback(async () => {
    setFoodDatePickerOpen(false);
    setFoodTimePickerOpen(false);
    setFoodDiaryFeedback(null);
    await onBack();
  }, [onBack]);

  const onDiscardAddFoodDraft = useCallback(() => {
    if (!isAddFoodEntryDirty) {
      setIsAddFoodEntryOpen(false);
      return;
    }
    Alert.alert(
      'Discard this food entry draft?',
      'Your unsaved entry will be removed.',
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard entry',
          style: 'destructive',
          onPress: () => {
            const initialFoodDate = currentLocalDate();
            const initialFoodTime = currentLocalTime();
            setMealTag(null);
            setFoodNote('');
            setFoodLoggedDate(initialFoodDate);
            setFoodLoggedTime(initialFoodTime);
            setAddFoodInitialDate(initialFoodDate);
            setAddFoodInitialTime(initialFoodTime);
            setIsAddFoodEntryDirty(false);
            setFoodDiaryFeedback(null);
            setFoodDatePickerOpen(false);
            setFoodTimePickerOpen(false);
            setIsAddFoodEntryOpen(false);
          },
        },
      ],
    );
  }, [isAddFoodEntryDirty]);

  const foodLoggedDateTimeValue = useMemo(() => {
    const iso = localDateTimeToIso(foodLoggedDate, foodLoggedTime);
    return iso ? new Date(iso) : new Date();
  }, [foodLoggedDate, foodLoggedTime]);

  const foodLoggedDateLabel = useMemo(() => {
    return foodLoggedDateTimeValue.toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    });
  }, [foodLoggedDateTimeValue]);

  const foodLoggedTimeLabel = useMemo(() => {
    return foodLoggedDateTimeValue.toLocaleTimeString(undefined, {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }, [foodLoggedDateTimeValue]);

  const onFoodDatePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setFoodDatePickerOpen(false);
      }
      if (event.type === 'dismissed') {
        return;
      }
      if (!selectedDate) {
        return;
      }
      const nextDate = localDateFromDate(selectedDate);
      setFoodLoggedDate(nextDate);
      if (editingFoodEntryId == null) {
        setIsAddFoodEntryDirty(
          computeIsAddFoodEntryDirty({
            mealTag,
            foodNote,
            foodLoggedDate: nextDate,
            foodLoggedTime,
          }),
        );
      }
    },
    [
      computeIsAddFoodEntryDirty,
      editingFoodEntryId,
      foodLoggedTime,
      foodNote,
      mealTag,
    ],
  );

  const onFoodTimePickerChange = useCallback(
    (event: DateTimePickerEvent, selectedDate?: Date) => {
      if (Platform.OS === 'android') {
        setFoodTimePickerOpen(false);
      }
      if (event.type === 'dismissed') {
        return;
      }
      if (!selectedDate) {
        return;
      }
      const nextTime = localTimeFromDate(selectedDate);
      setFoodLoggedTime(nextTime);
      if (editingFoodEntryId == null) {
        setIsAddFoodEntryDirty(
          computeIsAddFoodEntryDirty({
            mealTag,
            foodNote,
            foodLoggedDate,
            foodLoggedTime: nextTime,
          }),
        );
      }
    },
    [
      computeIsAddFoodEntryDirty,
      editingFoodEntryId,
      foodLoggedDate,
      foodNote,
      mealTag,
    ],
  );

  const onDeleteFoodEntry = useCallback(
    (entryId: string) => {
      if (savingFoodDiary || deletingFoodEntryId) {
        return;
      }
      Alert.alert('Discard this saved food entry?', 'This cannot be undone.', [
        { text: 'Keep entry', style: 'cancel' },
        {
          text: 'Discard entry',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              setDeletingFoodEntryId(entryId);
              setFoodDiaryFeedback(null);
              const result = await deleteFoodDiaryEntryOfflineFirst(
                supabase,
                powerSyncDatabase,
                entryId,
              );
              setDeletingFoodEntryId(null);
              if (!result.ok) {
                setFoodDiaryFeedback(result.error.message);
                await announce(result.error.message, {
                  politeness: 'assertive',
                });
                return;
              }
              if (editingFoodEntryId === entryId) {
                onNewFoodEntry();
                setIsAddFoodEntryOpen(false);
              }
              await loadFoodEntries();
              await announce('Food entry discarded.', { politeness: 'polite' });
            })();
          },
        },
      ]);
    },
    [
      deletingFoodEntryId,
      editingFoodEntryId,
      loadFoodEntries,
      onNewFoodEntry,
      powerSyncDatabase,
      savingFoodDiary,
      supabase,
    ],
  );

  return {
    reset,
    mealTag,
    setMealTag,
    foodNote,
    setFoodNote,
    foodLoggedDate,
    setFoodLoggedDate,
    foodLoggedTime,
    setFoodLoggedTime,
    foodEntries,
    foodEntriesLoading,
    foodEntriesError,
    savingFoodDiary,
    foodDiaryFeedback,
    editingFoodEntryId,
    deletingFoodEntryId,
    isAddFoodEntryOpen,
    setIsAddFoodEntryOpen,
    isAddFoodEntryDirty,
    setIsAddFoodEntryDirty,
    foodDatePickerOpen,
    setFoodDatePickerOpen,
    foodTimePickerOpen,
    setFoodTimePickerOpen,
    foodDiaryContinueDisabled,
    foodLoggedDateTimeValue,
    foodLoggedDateLabel,
    foodLoggedTimeLabel,
    computeIsAddFoodEntryDirty,
    loadFoodEntries,
    onSaveFoodDiary,
    onContinueFromFoodDiary,
    onBackFromFoodDiary,
    onEditFoodEntry,
    onNewFoodEntry,
    onDiscardFoodEditChanges,
    onDiscardAddFoodDraft,
    onFoodDatePickerChange,
    onFoodTimePickerChange,
    onDeleteFoodEntry,
  };
}
