import type {
  HealthMarkerRow,
  PresetHealthMarkerRow,
  Uuid,
} from '@abstrack/types';
import { validatePresetHealthMarkerCustomFields } from '@abstrack/types';
import { PresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
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

async function fetchEpisodeHealthMarkersForLine(
  client: AbstrackSupabaseClient,
  args: {
    episodeId: Uuid;
    line: PresetHealthMarkerRow;
  },
): Promise<{ data: HealthMarkerRow[]; error: unknown }> {
  const { episodeId, line } = args;
  const customName = normalizeCustomField(line.custom_name);
  const customUnit = normalizeCustomField(line.custom_unit);

  let q = client
    .from('health_markers')
    .select('*')
    .eq('episode_id', episodeId)
    .eq('marker_kind', line.marker_kind);

  if (customName === null) {
    q = q.is('custom_name', null);
  } else {
    q = q.eq('custom_name', customName);
  }
  if (customUnit === null) {
    q = q.is('custom_unit', null);
  } else {
    q = q.eq('custom_unit', customUnit);
  }

  const r = await q
    .order('recorded_at', { ascending: false })
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  return {
    data: (r.data ?? []) as HealthMarkerRow[],
    error: r.error,
  };
}

/**
 * Inserts or updates one `health_markers` row for the current episode + preset line signature.
 *
 * There is no direct FK from `health_markers` to `preset_health_markers`, so this helper matches a
 * row by `(episode_id, marker_kind, custom_name, custom_unit)` and updates the newest row when
 * present; otherwise it inserts a new row.
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
    const existing = await fetchEpisodeHealthMarkersForLine(client, {
      episodeId,
      line,
    });
    if (existing.error) {
      return { data: null, error: existing.error };
    }

    const payload = {
      marker_kind: line.marker_kind,
      custom_name: customName,
      custom_unit: customUnit,
      value_numeric: valueNumeric,
      systolic_numeric: systolicNumeric,
      diastolic_numeric: diastolicNumeric,
      notes,
      recorded_at: recordedAt,
    };

    if (existing.data.length > 0) {
      const upd = await client
        .from('health_markers')
        .update(payload)
        .eq('id', existing.data[0].id)
        .select('*')
        .single();
      return {
        data: upd.data as HealthMarkerRow | null,
        error: upd.error,
      };
    }

    const ins = await client
      .from('health_markers')
      .insert({
        user_id: userId,
        episode_id: episodeId,
        ...payload,
      })
      .select('*')
      .single();
    return {
      data: ins.data as HealthMarkerRow | null,
      error: ins.error,
    };
  });
}
