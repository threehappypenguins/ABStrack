import type { Uuid } from '@abstrack/types';
import type { Json } from './database.types.js';
import { toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** Time bucket granularity for `get_chart_series`. */
export type ChartSeriesBucket = 'day' | 'week' | 'month';

/** One series selection passed to `get_chart_series` (`p_series` JSON array element). */
export interface ChartSeriesSelection {
  series_id: string;
  series_type: 'health_marker' | 'symptom';
  response_type: 'numeric' | 'boolean' | 'severity';
  is_blood_pressure: boolean;
}

/**
 * One pre-bucketed row from `get_chart_series`.
 *
 * For severity symptoms, `value_*` aggregates rated observations only (NULL severities
 * excluded by SQL aggregates); `event_count` is total `severity_scale` rows in the bucket
 * (logging frequency), including rows without a rating.
 */
export interface ChartSeriesBucketRow {
  series_id: string;
  bucket_start: string;
  value_avg: number | null;
  value_min: number | null;
  value_max: number | null;
  systolic_avg: number | null;
  diastolic_avg: number | null;
  event_count: number | null;
}

/** Arguments for `get_chart_series`, matching the RPC parameter shape. */
export interface GetChartSeriesParams {
  p_user_id: Uuid;
  p_series: ChartSeriesSelection[];
  p_from: string;
  p_to: string;
  p_bucket: ChartSeriesBucket;
}

/**
 * Loads pre-bucketed time-series points for selected chart series via `get_chart_series`.
 * Uses `SECURITY INVOKER` so existing RLS on `health_markers` and `episode_symptoms` applies.
 *
 * @param client - Supabase client with the caller JWT.
 * @param params - RPC arguments (`p_user_id`, `p_series`, `p_from`, `p_to`, `p_bucket`).
 * @returns Bucketed rows from Postgres on success (`data` is unchanged RPC output).
 */
export async function getChartSeries(
  client: AbstrackSupabaseClient,
  params: GetChartSeriesParams,
): Promise<PresetDataResult<ChartSeriesBucketRow[]>> {
  try {
    const { data, error } = await client.rpc('get_chart_series', {
      p_user_id: params.p_user_id,
      p_series: params.p_series as unknown as Json,
      p_from: params.p_from,
      p_to: params.p_to,
      p_bucket: params.p_bucket,
    });

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    return {
      ok: true,
      data: (data ?? []) as ChartSeriesBucketRow[],
    };
  } catch (cause) {
    return { ok: false, error: toPresetDataError(cause) };
  }
}
