import type {
  HealthMarkerRow,
  PresetHealthMarkerKind,
  PresetHealthMarkerRow,
  Uuid,
} from '@abstrack/types';
import { validatePresetHealthMarkerCustomFields } from '@abstrack/types';
import { PresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { HealthMarkersInsert } from './health-markers-db-write-types.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

function normalizeCustomField(value: string | null | undefined): string | null {
  const next = value?.trim() ?? '';
  return next.length > 0 ? next : null;
}

/**
 * Ensures numeric columns match `marker_kind` (no DB CHECK today).
 * Non-blood-pressure kinds require a finite `value_numeric` so episode-bound rows are not
 * persisted without a measurement (resume logic keys off row existence).
 *
 * @returns User-facing message, or `null` when valid.
 */
/** @public Shared with mobile PowerSync offline inserts (same rules as REST path). */
export function validateHealthMarkerNumericPayload(
  markerKind: PresetHealthMarkerKind,
  valueNumeric: number | null | undefined,
  systolicNumeric: number | null | undefined,
  diastolicNumeric: number | null | undefined,
): string | null {
  const hasValue = valueNumeric !== null && valueNumeric !== undefined;
  const hasSys = systolicNumeric !== null && systolicNumeric !== undefined;
  const hasDia = diastolicNumeric !== null && diastolicNumeric !== undefined;

  if (markerKind === 'blood_pressure') {
    if (hasValue) {
      return 'Blood pressure uses systolic and diastolic values, not a single number.';
    }
    if (!hasSys || !hasDia) {
      return 'Enter systolic and diastolic blood pressure.';
    }
    if (
      !Number.isFinite(systolicNumeric) ||
      !Number.isFinite(diastolicNumeric)
    ) {
      return 'Blood pressure values must be valid numbers.';
    }
    return null;
  }

  if (hasSys || hasDia) {
    return 'This marker uses a single numeric value, not blood pressure fields.';
  }

  if (!hasValue) {
    return 'Enter a measurement value.';
  }
  if (!Number.isFinite(valueNumeric)) {
    return 'Enter a valid number.';
  }

  return null;
}

/**
 * Lists persisted `health_markers` rows for one episode, newest first.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @param options - Optional cap (`limit`) for newest rows after source ordering.
 */
export async function listEpisodeHealthMarkersForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  options: {
    limit?: number;
  } = {},
): Promise<PresetDataResult<HealthMarkerRow[]>> {
  const limit = options.limit;
  return wrap(async () => {
    let query = client
      .from('health_markers')
      .select('*')
      .eq('episode_id', episodeId)
      .order('recorded_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    if (limit != null) {
      query = query.limit(limit);
    }
    const r = await query;
    return {
      data: (r.data ?? []) as HealthMarkerRow[],
      error: r.error,
    };
  });
}

/**
 * Lists standalone `health_markers` rows for one user (`episode_id` is null), newest first.
 *
 * @param client - Supabase client (RLS applies).
 * @param userId - `health_markers.user_id`.
 * @param options - Pagination and optional `recorded_at` bounds (ISO timestamptz).
 */
export async function listStandaloneHealthMarkersForUser(
  client: AbstrackSupabaseClient,
  userId: Uuid,
  options: {
    limit?: number;
    offset?: number;
    recordedAtOrAfter?: string | null;
    recordedAtOrBefore?: string | null;
  } = {},
): Promise<PresetDataResult<HealthMarkerRow[]>> {
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
      .from('health_markers')
      .select('*')
      .eq('user_id', userId)
      .is('episode_id', null);
    if (options.recordedAtOrAfter) {
      query = query.gte('recorded_at', options.recordedAtOrAfter);
    }
    if (options.recordedAtOrBefore) {
      query = query.lte('recorded_at', options.recordedAtOrBefore);
    }
    const r = await query
      .order('recorded_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, rangeEnd);
    return {
      data: (r.data ?? []) as HealthMarkerRow[],
      error: r.error,
    };
  });
}

/**
 * Deletes one `health_markers` row by id when visible under RLS (typically the owner).
 *
 * @param client - Supabase client (RLS applies).
 * @param markerId - `health_markers.id`.
 * @returns `true` when a row was deleted.
 */
export async function deleteHealthMarkerById(
  client: AbstrackSupabaseClient,
  markerId: Uuid,
): Promise<PresetDataResult<boolean>> {
  return wrap(async () => {
    const r = await client
      .from('health_markers')
      .delete()
      .eq('id', markerId)
      .select('id')
      .maybeSingle();
    return {
      data: r.data != null,
      error: r.error,
    };
  });
}

/**
 * Inserts one `health_markers` row for the current episode + preset line (a new observation per
 * pass; prior rows are kept and ordered by `recorded_at` / `id`).
 * Intentional: episode observations are append-only for auditability/history, so this helper is
 * insert-only (no upsert path).
 *
 * @param client - Supabase client (RLS applies).
 * @param args.userId - Must match the episode owner (`episodes.user_id`) under RLS.
 * @param args.episodeId - `episodes.id`.
 * @param args.line - Active preset health marker line.
 * @param args.valueNumeric - Required finite number for non-blood-pressure kinds (omitted or
 *   non-finite values return `validation_error`).
 * @param args.systolicNumeric - Systolic value for blood pressure.
 * @param args.diastolicNumeric - Diastolic value for blood pressure.
 * @param args.notes - Optional free-text note.
 * @param args.recordedAt - Timestamp override (defaults to now).
 *
 * Numeric fields must match `line.marker_kind` (e.g. `blood_pressure` uses systolic/diastolic and
 * leaves `value_numeric` empty; other kinds use `value_numeric` only). Otherwise returns
 * `validation_error`.
 */
export async function insertEpisodeHealthMarkerForLine(
  client: AbstrackSupabaseClient,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    line: PresetHealthMarkerRow;
    valueNumeric?: number | null;
    systolicNumeric?: number | null;
    diastolicNumeric?: number | null;
    notes?: string | null;
    recordedAt?: string;
  },
): Promise<PresetDataResult<HealthMarkerRow>> {
  const {
    userId,
    episodeId,
    line,
    valueNumeric = null,
    systolicNumeric = null,
    diastolicNumeric = null,
    notes = null,
    recordedAt = new Date().toISOString(),
  } = args;

  const customName = normalizeCustomField(line.custom_name);
  const customUnit = normalizeCustomField(line.custom_unit);
  const customValidation = validatePresetHealthMarkerCustomFields(
    line.marker_kind,
    customName ?? '',
    customUnit ?? '',
  );
  if (customValidation) {
    return {
      ok: false,
      error: new PresetDataError('validation_error', customValidation),
    };
  }

  const numericValidation = validateHealthMarkerNumericPayload(
    line.marker_kind,
    valueNumeric,
    systolicNumeric,
    diastolicNumeric,
  );
  if (numericValidation) {
    return {
      ok: false,
      error: new PresetDataError('validation_error', numericValidation),
    };
  }

  return wrap(async () => {
    const row: HealthMarkersInsert = buildHealthMarkerInsertRowForEpisodeLine({
      userId,
      episodeId,
      line,
      customName,
      customUnit,
      valueNumeric,
      systolicNumeric,
      diastolicNumeric,
      notes,
      recordedAt,
    });

    const r = await client
      .from('health_markers')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as HealthMarkerRow | null,
      error: r.error,
    };
  });
}

/**
 * Builds the PostgREST / PowerSync insert payload for an episode-bound or standalone health marker
 * line (same shape as {@link insertEpisodeHealthMarkerForLine} / {@link createStandaloneHealthMarkerForLine}).
 *
 * @param args - Normalized custom fields and numeric measurements after validation.
 */
export function buildHealthMarkerInsertRowForEpisodeLine(args: {
  userId: Uuid;
  episodeId: Uuid | null;
  line: PresetHealthMarkerRow;
  customName: string | null;
  customUnit: string | null;
  valueNumeric: number | null;
  systolicNumeric: number | null;
  diastolicNumeric: number | null;
  notes: string | null;
  recordedAt: string;
}): HealthMarkersInsert {
  const {
    userId,
    episodeId,
    line,
    customName,
    customUnit,
    valueNumeric,
    systolicNumeric,
    diastolicNumeric,
    notes,
    recordedAt,
  } = args;
  return {
    user_id: userId,
    episode_id: episodeId,
    preset_health_marker_id: line.id,
    marker_kind: line.marker_kind,
    custom_name: customName,
    custom_unit: customUnit,
    value_numeric: line.marker_kind === 'blood_pressure' ? null : valueNumeric,
    systolic_numeric:
      line.marker_kind === 'blood_pressure' ? systolicNumeric : null,
    diastolic_numeric:
      line.marker_kind === 'blood_pressure' ? diastolicNumeric : null,
    notes,
    recorded_at: recordedAt,
  };
}

/**
 * Inserts one standalone `health_markers` row (`episode_id = null`) from a preset line.
 *
 * @param client - Supabase client (RLS applies).
 * @param args.userId - Authenticated patient (or caretaker target under RLS).
 * @param args.line - Active preset health marker line.
 * @param args.valueNumeric - Required finite number for non-blood-pressure kinds.
 * @param args.systolicNumeric - Systolic value for blood pressure.
 * @param args.diastolicNumeric - Diastolic value for blood pressure.
 * @param args.notes - Optional free-text note.
 * @param args.recordedAt - Timestamp override (defaults to now).
 * @returns Inserted marker row with `episode_id = null`.
 */
export async function createStandaloneHealthMarkerForLine(
  client: AbstrackSupabaseClient,
  args: {
    userId: Uuid;
    line: PresetHealthMarkerRow;
    valueNumeric?: number | null;
    systolicNumeric?: number | null;
    diastolicNumeric?: number | null;
    notes?: string | null;
    recordedAt?: string;
  },
): Promise<PresetDataResult<HealthMarkerRow>> {
  const {
    userId,
    line,
    valueNumeric = null,
    systolicNumeric = null,
    diastolicNumeric = null,
    notes = null,
    recordedAt = new Date().toISOString(),
  } = args;
  const customName = normalizeCustomField(line.custom_name);
  const customUnit = normalizeCustomField(line.custom_unit);
  const customValidation = validatePresetHealthMarkerCustomFields(
    line.marker_kind,
    customName ?? '',
    customUnit ?? '',
  );
  if (customValidation) {
    return {
      ok: false,
      error: new PresetDataError('validation_error', customValidation),
    };
  }
  const numericValidation = validateHealthMarkerNumericPayload(
    line.marker_kind,
    valueNumeric,
    systolicNumeric,
    diastolicNumeric,
  );
  if (numericValidation) {
    return {
      ok: false,
      error: new PresetDataError('validation_error', numericValidation),
    };
  }
  return wrap(async () => {
    const row = buildHealthMarkerInsertRowForEpisodeLine({
      userId,
      episodeId: null,
      line,
      customName,
      customUnit,
      valueNumeric,
      systolicNumeric,
      diastolicNumeric,
      notes,
      recordedAt,
    });
    const r = await client
      .from('health_markers')
      .insert(row)
      .select('*')
      .single();
    return {
      data: r.data as HealthMarkerRow | null,
      error: r.error,
    };
  });
}
