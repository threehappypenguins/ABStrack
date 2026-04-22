import type {
  FoodDiaryEntryInsert,
  FoodDiaryEntryRow,
  FoodDiaryEntryUpdate,
  Uuid,
} from '@abstrack/types';
import { isMealTag } from '@abstrack/types';
import { PresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

function normalizeFoodNote(note: string): string | null {
  const next = note.trim();
  return next.length > 0 ? next : null;
}

function normalizeOptionalIso(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const next = value.trim();
  if (!next) {
    return null;
  }
  const time = Date.parse(next);
  if (!Number.isFinite(time)) {
    return null;
  }
  return new Date(time).toISOString();
}

function validateFoodDiaryPayload(
  payload: Pick<FoodDiaryEntryInsert, 'meal_tag' | 'food_note' | 'logged_at'>,
): PresetDataError | null {
  if (!isMealTag(payload.meal_tag)) {
    return new PresetDataError(
      'validation_error',
      'Choose a valid meal tag (Breakfast, Lunch, Dinner, Snack, or Other).',
    );
  }
  if (!normalizeFoodNote(payload.food_note)) {
    return new PresetDataError(
      'validation_error',
      'Enter what you ate or drank before saving.',
    );
  }
  if (!normalizeOptionalIso(payload.logged_at)) {
    return new PresetDataError(
      'validation_error',
      'Enter a valid date and time.',
    );
  }
  return null;
}

/**
 * Lists food diary entries for one user (newest first).
 *
 * @param client - Supabase client (RLS applies).
 * @param userId - `auth.users.id` / `food_diary_entries.user_id`.
 * @param options - Optional result cap (`limit`, default `50`).
 */
export async function listFoodDiaryEntriesForUser(
  client: AbstrackSupabaseClient,
  userId: Uuid,
  options: { limit?: number } = {},
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  const limit = options.limit ?? 50;
  return wrap(async () => {
    const r = await client
      .from('food_diary_entries')
      .select('*')
      .eq('user_id', userId)
      .order('logged_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    return {
      data: (r.data ?? []) as FoodDiaryEntryRow[],
      error: r.error,
    };
  });
}

/**
 * Lists food diary entries linked to one episode (newest first).
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id` linked from `food_diary_entries.episode_id`.
 * @param options - Optional result cap (`limit`, default `50`).
 */
export async function listFoodDiaryEntriesForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  options: { limit?: number } = {},
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  const limit = options.limit ?? 50;
  return wrap(async () => {
    const r = await client
      .from('food_diary_entries')
      .select('*')
      .eq('episode_id', episodeId)
      .order('logged_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(limit);
    return {
      data: (r.data ?? []) as FoodDiaryEntryRow[],
      error: r.error,
    };
  });
}

/**
 * Creates one food diary entry. `episode_id` can be `null` for standalone home entries.
 *
 * @param client - Supabase client (RLS applies).
 * @param row - Insert payload.
 */
export async function createFoodDiaryEntry(
  client: AbstrackSupabaseClient,
  row: FoodDiaryEntryInsert,
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const validation = validateFoodDiaryPayload(row);
  if (validation) {
    return { ok: false, error: validation };
  }
  const loggedAt = normalizeOptionalIso(row.logged_at);
  const foodNote = normalizeFoodNote(row.food_note);
  if (!loggedAt || !foodNote) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Invalid food diary entry.',
      ),
    };
  }
  return wrap(async () => {
    const r = await client
      .from('food_diary_entries')
      .insert({
        ...row,
        food_note: foodNote,
        logged_at: loggedAt,
      })
      .select('*')
      .single();
    return {
      data: r.data as FoodDiaryEntryRow | null,
      error: r.error,
    };
  });
}

/**
 * Updates one food diary entry.
 *
 * @param client - Supabase client (RLS applies).
 * @param entryId - `food_diary_entries.id`.
 * @param patch - Fields to change.
 */
export async function updateFoodDiaryEntry(
  client: AbstrackSupabaseClient,
  entryId: Uuid,
  patch: FoodDiaryEntryUpdate,
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const normalizedPatch: FoodDiaryEntryUpdate = { ...patch };
  if (normalizedPatch.food_note !== undefined) {
    const next = normalizeFoodNote(normalizedPatch.food_note);
    if (!next) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Enter what you ate or drank before saving.',
        ),
      };
    }
    normalizedPatch.food_note = next;
  }
  if (
    normalizedPatch.meal_tag !== undefined &&
    !isMealTag(normalizedPatch.meal_tag)
  ) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Choose a valid meal tag (Breakfast, Lunch, Dinner, Snack, or Other).',
      ),
    };
  }
  if (normalizedPatch.logged_at !== undefined) {
    const loggedAt = normalizeOptionalIso(normalizedPatch.logged_at);
    if (!loggedAt) {
      return {
        ok: false,
        error: new PresetDataError(
          'validation_error',
          'Enter a valid date and time.',
        ),
      };
    }
    normalizedPatch.logged_at = loggedAt;
  }

  return wrap(async () => {
    const r = await client
      .from('food_diary_entries')
      .update(normalizedPatch)
      .eq('id', entryId)
      .select('*')
      .single();
    return {
      data: r.data as FoodDiaryEntryRow | null,
      error: r.error,
    };
  });
}

/**
 * Deletes one food diary entry by id.
 *
 * @param client - Supabase client (RLS applies).
 * @param entryId - `food_diary_entries.id`.
 */
export async function deleteFoodDiaryEntry(
  client: AbstrackSupabaseClient,
  entryId: Uuid,
): Promise<PresetDataResult<boolean>> {
  return wrap(async () => {
    const r = await client
      .from('food_diary_entries')
      .delete()
      .eq('id', entryId)
      .select('id')
      .maybeSingle();
    return {
      data: r.data != null,
      error: r.error,
    };
  });
}
