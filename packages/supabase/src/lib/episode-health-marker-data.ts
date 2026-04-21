import type {
  HealthMarkerRow,
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
 * Lists persisted `health_markers` rows for one episode, newest first.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 */
export async function listEpisodeHealthMarkersForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<HealthMarkerRow[]>> {
  return wrap(async () => {
    const r = await client
      .from('health_markers')
      .select('*')
      .eq('episode_id', episodeId)
      .order('recorded_at', { ascending: false })
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    return {
      data: (r.data ?? []) as HealthMarkerRow[],
      error: r.error,
    };
  });
}

/**
 * Inserts or updates one `health_markers` row for the current episode + preset line.
 *
 * Episode-bound rows are keyed by `(episode_id, preset_health_marker_id)` where
 * `preset_health_marker_id` is {@link PresetHealthMarkerRow.id}. That allows multiple template lines
 * with the same `marker_kind` (e.g. two glucose steps) without colliding. A non-partial unique
 * constraint on `(episode_id, preset_health_marker_id)` (see migration
 * `20260421120000_health_markers_episode_line_unique.sql`) is required so PostgREST can infer
 * `onConflict`; partial unique indexes do not match. Wellness rows stay allowed (NULL distinctness).
 * This function uses one `upsert` so concurrent clients cannot double-insert the same line.
 *
 * @param client - Supabase client (RLS applies).
 * @param args.userId - Must match the episode owner (`episodes.user_id`) under RLS.
 * @param args.episodeId - `episodes.id`.
 * @param args.line - Active preset health marker line.
 * @param args.valueNumeric - Numeric value for non-blood-pressure kinds.
 * @param args.systolicNumeric - Systolic value for blood pressure.
 * @param args.diastolicNumeric - Diastolic value for blood pressure.
 * @param args.notes - Optional free-text note.
 * @param args.recordedAt - Timestamp override (defaults to now).
 */
export async function upsertEpisodeHealthMarkerForLine(
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

  return wrap(async () => {
    const row: HealthMarkersInsert = {
      user_id: userId,
      episode_id: episodeId,
      preset_health_marker_id: line.id,
      marker_kind: line.marker_kind,
      custom_name: customName,
      custom_unit: customUnit,
      value_numeric: valueNumeric,
      systolic_numeric: systolicNumeric,
      diastolic_numeric: diastolicNumeric,
      notes,
      recorded_at: recordedAt,
    };

    const r = await client
      .from('health_markers')
      .upsert(row, {
        onConflict: 'episode_id,preset_health_marker_id',
      })
      .select('*')
      .single();
    return {
      data: r.data as HealthMarkerRow | null,
      error: r.error,
    };
  });
}
