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

/**
 * Fractional-second digits from ISO (e.g. `007` or `7`) to 0–999 ms, matching typical
 * `Date` / `toISOString` millisecond precision.
 */
function isoFractionToMs(frac: string | undefined): number {
  if (frac == null || frac === '') {
    return 0;
  }
  const n = Number(`0.${frac}`);
  if (!Number.isFinite(n)) {
    return 0;
  }
  return Math.min(999, Math.max(0, Math.floor(n * 1000)));
}

function civilDayExistsInUtcCalendar(
  year: number,
  month: number,
  day: number,
): boolean {
  const probe = Date.UTC(year, month - 1, day, 12, 0, 0, 0);
  const d = new Date(probe);
  return (
    d.getUTCFullYear() === year &&
    d.getUTCMonth() === month - 1 &&
    d.getUTCDate() === day
  );
}

/** ISO-8601 instant with required clock time and explicit `Z` or `±HH:MM` (not date-only). */
const STRICT_LOGGED_AT_ISO_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,9}))?)?(Z|([+-])(\d{2}):(\d{2}))$/;

function normalizeOptionalIso(value: string | null | undefined): string | null {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const match = STRICT_LOGGED_AT_ISO_RE.exec(trimmed);
  if (!match) {
    return null;
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] != null && match[6] !== '' ? Number(match[6]) : 0;
  const ms = isoFractionToMs(match[7]);
  const tz = match[8];

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  if (!civilDayExistsInUtcCalendar(year, month, day)) {
    return null;
  }

  let utcMs: number;

  if (tz === 'Z') {
    utcMs = Date.UTC(year, month - 1, day, hour, minute, second, ms);
    const check = new Date(utcMs);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day ||
      check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute ||
      check.getUTCSeconds() !== second ||
      check.getUTCMilliseconds() !== ms
    ) {
      return null;
    }
  } else {
    const sign = match[9];
    const offH = Number(match[10]);
    const offM = Number(match[11]);
    if (
      !Number.isFinite(offH) ||
      !Number.isFinite(offM) ||
      offH > 23 ||
      offM > 59
    ) {
      return null;
    }
    const offsetMinutesEast =
      sign === '+' ? offH * 60 + offM : -(offH * 60 + offM);
    utcMs =
      Date.UTC(year, month - 1, day, hour, minute, second, ms) -
      offsetMinutesEast * 60 * 1000;
    if (!Number.isFinite(utcMs)) {
      return null;
    }
    const civilAsUtcTicks = utcMs + offsetMinutesEast * 60 * 1000;
    const check = new Date(civilAsUtcTicks);
    if (
      check.getUTCFullYear() !== year ||
      check.getUTCMonth() !== month - 1 ||
      check.getUTCDate() !== day ||
      check.getUTCHours() !== hour ||
      check.getUTCMinutes() !== minute ||
      check.getUTCSeconds() !== second ||
      check.getUTCMilliseconds() !== ms
    ) {
      return null;
    }
  }

  return new Date(utcMs).toISOString();
}

type FoodDiaryCreateCore = Pick<
  FoodDiaryEntryInsert,
  'meal_tag' | 'food_note' | 'logged_at'
>;

type ValidateCreateCoreResult =
  | { ok: true; food_note: string; logged_at: string }
  | { ok: false; error: PresetDataError };

/**
 * Validates meal tag / note / logged_at and returns normalized strings for insert
 * (single pass — avoids re-parsing after validation).
 */
function validateAndNormalizeFoodDiaryCreateCore(
  payload: FoodDiaryCreateCore,
): ValidateCreateCoreResult {
  if (!isMealTag(payload.meal_tag)) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Choose a valid meal tag (Breakfast, Lunch, Dinner, Snack, or Other).',
      ),
    };
  }
  const foodNote = normalizeFoodNote(payload.food_note);
  if (!foodNote) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Enter what you ate or drank before saving.',
      ),
    };
  }
  const loggedAt = normalizeOptionalIso(payload.logged_at);
  if (!loggedAt) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Enter a valid date and time.',
      ),
    };
  }
  return { ok: true, food_note: foodNote, logged_at: loggedAt };
}

/**
 * Lists food diary entries for one user (newest first).
 *
 * @param client - Supabase client (RLS applies).
 * @param userId - `auth.users.id` / `food_diary_entries.user_id`.
 * @param options - Pagination (`limit`, default `50`; `offset`, default `0`), optional
 *   `standaloneOnly` (`episode_id` is null), and optional `logged_at` bounds (ISO timestamptz).
 */
export async function listFoodDiaryEntriesForUser(
  client: AbstrackSupabaseClient,
  userId: Uuid,
  options: {
    limit?: number;
    offset?: number;
    standaloneOnly?: boolean;
    loggedAtOrAfter?: string | null;
    loggedAtOrBefore?: string | null;
  } = {},
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  const rawLimit = options.limit ?? 50;
  const rawOffset = options.offset ?? 0;
  const limit = Number.isFinite(rawLimit) ? Math.trunc(rawLimit) : 50;
  const offset = Number.isFinite(rawOffset)
    ? Math.max(0, Math.trunc(rawOffset))
    : 0;
  if (limit <= 0) {
    return { ok: true, data: [] };
  }
  const rangeEnd = offset + limit - 1;
  return wrap(async () => {
    let query = client
      .from('food_diary_entries')
      .select('*')
      .eq('user_id', userId);
    if (options.standaloneOnly) {
      query = query.is('episode_id', null);
    }
    if (options.loggedAtOrAfter) {
      query = query.gte('logged_at', options.loggedAtOrAfter);
    }
    if (options.loggedAtOrBefore) {
      query = query.lte('logged_at', options.loggedAtOrBefore);
    }
    const r = await query
      .order('logged_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, rangeEnd);
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
 * In episode flows, this is the preferred append-only observation write (new entries insert rows
 * rather than overwriting prior logs).
 *
 * @param client - Supabase client (RLS applies).
 * @param row - Insert payload.
 */
export async function createFoodDiaryEntry(
  client: AbstrackSupabaseClient,
  row: FoodDiaryEntryInsert,
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const core = validateAndNormalizeFoodDiaryCreateCore(row);
  if (!core.ok) {
    return { ok: false, error: core.error };
  }
  return wrap(async () => {
    const r = await client
      .from('food_diary_entries')
      .insert({
        ...row,
        food_note: core.food_note,
        logged_at: core.logged_at,
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
