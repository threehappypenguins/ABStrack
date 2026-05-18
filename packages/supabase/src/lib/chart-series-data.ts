import type { Uuid } from '@abstrack/types';
import type { PostgrestError } from '@supabase/supabase-js';
import { toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/** Time bucket granularity for `get_chart_series`. */
export type ChartSeriesBucket = 'day' | 'week' | 'month';

/** One series selection passed to `get_chart_series` (`p_series` JSON array element). */
export type ChartSeriesSelection = {
  series_id: string;
  series_type: 'health_marker' | 'symptom';
  response_type: 'numeric' | 'boolean' | 'severity';
  is_blood_pressure: boolean;
};

/** One pre-bucketed row from `get_chart_series`. */
export type ChartSeriesBucketRow = {
  series_id: string;
  bucket_start: string;
  value_avg: number | null;
  value_min: number | null;
  value_max: number | null;
  systolic_avg: number | null;
  diastolic_avg: number | null;
  event_count: number | null;
};

type ChartSeriesBucketRowRaw = ChartSeriesBucketRow;

type GetChartSeriesRpcArgs = {
  p_user_id: Uuid;
  p_series: ChartSeriesSelection[];
  p_from: string;
  p_to: string;
  p_bucket: ChartSeriesBucket;
};

/**
 * Invokes `get_chart_series` before the RPC appears in generated `database.types.ts`.
 * Remove this shim after `supabase gen types typescript --linked` includes the function.
 */
function rpcGetChartSeries(
  client: AbstrackSupabaseClient,
  args: GetChartSeriesRpcArgs,
): Promise<{
  data: ChartSeriesBucketRow[] | null;
  error: PostgrestError | null;
}> {
  type RpcClient = {
    rpc(
      fn: 'get_chart_series',
      rpcArgs: GetChartSeriesRpcArgs,
    ): Promise<{
      data: ChartSeriesBucketRow[] | null;
      error: PostgrestError | null;
    }>;
  };

  return (client as unknown as RpcClient).rpc('get_chart_series', args);
}

/**
 * Loads pre-bucketed time-series points for selected chart series via Postgres RPC.
 * Uses `SECURITY INVOKER` so existing RLS on `health_markers` and `episode_symptoms` applies.
 *
 * @param client - Supabase client with the caller JWT (patient, caretaker, or practitioner).
 * @param userId - Subject user id (`p_user_id`).
 * @param series - One to three manifest series descriptors (`p_series`).
 * @param from - Range start (`p_from`), inclusive.
 * @param to - Range end (`p_to`), inclusive.
 * @param bucket - Bucket size: `day`, `week`, or `month` (`p_bucket`).
 * @returns Bucketed rows for all requested series, ordered by `series_id` then `bucket_start`.
 */
export async function getChartSeries(
  client: AbstrackSupabaseClient,
  userId: Uuid,
  series: ChartSeriesSelection[],
  from: string,
  to: string,
  bucket: ChartSeriesBucket,
): Promise<PresetDataResult<ChartSeriesBucketRow[]>> {
  try {
    const { data, error } = await rpcGetChartSeries(client, {
      p_user_id: userId,
      p_series: series,
      p_from: from,
      p_to: to,
      p_bucket: bucket,
    });

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    return {
      ok: true,
      data: (data ?? []) as ChartSeriesBucketRowRaw[],
    };
  } catch (cause) {
    return { ok: false, error: toPresetDataError(cause) };
  }
}
