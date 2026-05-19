import type { Uuid } from '@abstrack/types';
import type { Json } from './database.types.js';
import type { ChartSeriesBucket } from './chart-series-query.js';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** One `chart_snapshots` row (patient or practitioner SELECT via RLS). */
export interface ChartSnapshotRow {
  id: Uuid;
  patient_user_id: Uuid;
  practitioner_user_id: Uuid;
  series_definition: ChartSnapshotSeriesDefinition[];
  date_from: string;
  date_to: string;
  bucket: ChartSeriesBucket;
  practitioner_note: string | null;
  created_at: string;
  seen_by_patient_at: string | null;
}

/** Matches `chart_snapshots_practitioner_note_len` (`char_length(practitioner_note) <= 16000`). */
export const CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH = 16_000;

function normalizeChartSnapshotPractitionerNote(
  note: string | null | undefined,
): string | null {
  if (note == null) {
    return null;
  }
  const trimmed = note.trim();
  return trimmed.length === 0 ? null : trimmed;
}

/**
 * One element of `chart_snapshots.series_definition` — mirrors {@link SelectedSeries}
 * from `@abstrack/ui` (camelCase JSON stored in Postgres).
 */
export interface ChartSnapshotSeriesDefinition {
  seriesId: string;
  seriesType: 'health_marker' | 'symptom';
  responseType: 'numeric' | 'boolean' | 'severity';
  isBloodPressure: boolean;
  label: string;
  unit: string | null;
  chartType: 'line' | 'bar' | 'scatter' | 'event' | 'bp_band';
  color: string;
}

/** Arguments for `share_chart_snapshot`. */
export interface ShareChartSnapshotParams {
  patientUserId: Uuid;
  seriesDefinition: ChartSnapshotSeriesDefinition[];
  /** Inclusive range start (ISO timestamp). */
  dateFrom: string;
  /** Exclusive range end (ISO timestamp). */
  dateTo: string;
  bucket: ChartSeriesBucket;
  practitionerNote?: string | null;
}

/**
 * Shares the current chart configuration with the patient via `share_chart_snapshot`.
 * Requires an active `practitioner_access` grant and practitioner MFA (via RLS helper).
 *
 * @param client - Supabase client with the practitioner JWT.
 * @param params - Snapshot payload (patient, series, date range, bucket, optional note).
 * @returns New snapshot id on success.
 */
export async function shareChartSnapshot(
  client: AbstrackSupabaseClient,
  params: ShareChartSnapshotParams,
): Promise<PresetDataResult<Uuid>> {
  const practitionerNote = normalizeChartSnapshotPractitionerNote(
    params.practitionerNote,
  );
  if (
    practitionerNote != null &&
    practitionerNote.length > CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH
  ) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        `Notes must be ${CHART_SNAPSHOT_PRACTITIONER_NOTE_MAX_LENGTH.toLocaleString()} characters or fewer.`,
      ),
    };
  }

  try {
    const { data, error } = await client.rpc('share_chart_snapshot', {
      p_patient_user_id: params.patientUserId,
      p_series_definition: params.seriesDefinition as unknown as Json,
      p_date_from: params.dateFrom,
      p_date_to: params.dateTo,
      p_bucket: params.bucket,
      p_practitioner_note: practitionerNote ?? undefined,
    });

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    if (typeof data !== 'string' || data.length === 0) {
      return {
        ok: false,
        error: toPresetDataError(
          new Error('share_chart_snapshot returned no id'),
        ),
      };
    }

    return { ok: true, data };
  } catch (cause) {
    return { ok: false, error: toPresetDataError(cause) };
  }
}

/**
 * Lists unseen chart snapshots for the signed-in patient (`seen_by_patient_at IS NULL`).
 *
 * @param client - Supabase client with the patient JWT.
 * @returns Newest-first unseen rows (RLS limits to `patient_user_id = auth.uid()`).
 */
export async function listUnseenChartSnapshotsForPatient(
  client: AbstrackSupabaseClient,
): Promise<PresetDataResult<ChartSnapshotRow[]>> {
  try {
    const { data, error } = await client
      .from('chart_snapshots')
      .select(
        'id, patient_user_id, practitioner_user_id, series_definition, date_from, date_to, bucket, practitioner_note, created_at, seen_by_patient_at',
      )
      .is('seen_by_patient_at', null)
      .order('created_at', { ascending: false });

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    return {
      ok: true,
      data: (data ?? []) as unknown as ChartSnapshotRow[],
    };
  } catch (cause) {
    return { ok: false, error: toPresetDataError(cause) };
  }
}

/**
 * Marks a shared chart snapshot as seen by the patient (`mark_chart_snapshot_seen`).
 *
 * @param client - Supabase client with the patient JWT.
 * @param snapshotId - `chart_snapshots.id`.
 * @returns Whether a row was updated (false if already seen or not found).
 */
export async function markChartSnapshotSeen(
  client: AbstrackSupabaseClient,
  snapshotId: Uuid,
): Promise<PresetDataResult<boolean>> {
  try {
    const { data, error } = await client.rpc('mark_chart_snapshot_seen', {
      p_snapshot_id: snapshotId,
    });

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    return { ok: true, data: Boolean(data) };
  } catch (cause) {
    return { ok: false, error: toPresetDataError(cause) };
  }
}
