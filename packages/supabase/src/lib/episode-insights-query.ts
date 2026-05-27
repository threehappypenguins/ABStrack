import type { Uuid } from '@abstrack/types';
import { toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

type InsightsRpcClient = {
  rpc(
    fn: string,
    args: Record<string, unknown>,
  ): Promise<{ data: unknown; error: unknown }>;
};

/**
 * Shared range arguments for episode insights RPCs that bucket or summarize in a timezone.
 */
export interface EpisodeInsightsRangeParams {
  p_user_id: Uuid;
  p_from: string;
  p_to: string;
  p_timezone: string;
}

/**
 * Summary metrics returned by `get_episode_summary`.
 */
export interface EpisodeSummaryRow {
  total_episode_count: number;
  abs_episode_count: number;
  other_episode_count: number;
  average_episodes_per_week: number | null;
  longest_episode_free_streak_days: number | null;
  current_episode_free_streak_days: number | null;
  average_episode_duration_hours: number | null;
}

/**
 * One weekly episode-count bucket for the overview heatmap.
 */
export interface EpisodeWeekCountRow {
  week_start: string;
  episode_type: 'ABS' | 'Other';
  episode_count: number;
}

/**
 * One hourly episode-start count for the overview start-time chart.
 */
export interface EpisodeStartHourDistributionRow {
  hour_of_day: number;
  episode_type: 'ABS' | 'Other';
  episode_count: number;
}

/**
 * One aggregated symptom-frequency row for the selected period.
 */
export interface SymptomFrequencyRow {
  symptom_name: string;
  occurrence_count: number;
}

/**
 * Combined overview payload used by patient and practitioner insights surfaces.
 */
export interface EpisodeInsightsOverviewData {
  summary: EpisodeSummaryRow | null;
  weekCounts: EpisodeWeekCountRow[];
  symptomFrequencies: SymptomFrequencyRow[];
  startHourDistribution: EpisodeStartHourDistributionRow[];
}

async function callInsightsRpc<TRow>(
  client: AbstrackSupabaseClient,
  functionName: string,
  args: Record<string, unknown>,
): Promise<PresetDataResult<TRow[]>> {
  try {
    const { data, error } = await (client as unknown as InsightsRpcClient).rpc(
      functionName,
      args,
    );

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    return {
      ok: true,
      data: (data ?? []) as TRow[],
    };
  } catch (cause) {
    return { ok: false, error: toPresetDataError(cause) };
  }
}

/**
 * Loads overview summary metrics for episodes in the selected period.
 *
 * @param client - Supabase client with the caller JWT.
 * @param params - User, range, and IANA timezone parameters for the RPC.
 * @returns One summary row, or `null` if the RPC returned no rows.
 */
export async function getEpisodeSummary(
  client: AbstrackSupabaseClient,
  params: EpisodeInsightsRangeParams,
): Promise<PresetDataResult<EpisodeSummaryRow | null>> {
  const result = await callInsightsRpc<EpisodeSummaryRow>(
    client,
    'get_episode_summary',
    {
      p_user_id: params.p_user_id,
      p_from: params.p_from,
      p_to: params.p_to,
      p_timezone: params.p_timezone,
    },
  );

  if (!result.ok) {
    return result;
  }

  const [row] = result.data;
  return { ok: true, data: row ?? null };
}

/**
 * Loads weekly episode counts grouped by episode type for the overview heatmap.
 *
 * @param client - Supabase client with the caller JWT.
 * @param params - User, range, and IANA timezone parameters for the RPC.
 * @returns Weekly buckets ordered by week start.
 */
export async function getEpisodeWeekCounts(
  client: AbstrackSupabaseClient,
  params: EpisodeInsightsRangeParams,
): Promise<PresetDataResult<EpisodeWeekCountRow[]>> {
  return callInsightsRpc<EpisodeWeekCountRow>(
    client,
    'get_episode_week_counts',
    {
      p_user_id: params.p_user_id,
      p_from: params.p_from,
      p_to: params.p_to,
      p_timezone: params.p_timezone,
    },
  );
}

/**
 * Loads hourly episode-start counts grouped by episode type.
 *
 * @param client - Supabase client with the caller JWT.
 * @param params - User, range, and IANA timezone parameters for the RPC.
 * @returns Hour-of-day buckets ordered by hour.
 */
export async function getEpisodeStartHourDistribution(
  client: AbstrackSupabaseClient,
  params: EpisodeInsightsRangeParams,
): Promise<PresetDataResult<EpisodeStartHourDistributionRow[]>> {
  return callInsightsRpc<EpisodeStartHourDistributionRow>(
    client,
    'get_episode_start_hour_distribution',
    {
      p_user_id: params.p_user_id,
      p_from: params.p_from,
      p_to: params.p_to,
      p_timezone: params.p_timezone,
    },
  );
}

/**
 * Loads symptom counts for episode symptoms recorded in the selected period.
 *
 * @param client - Supabase client with the caller JWT.
 * @param params - User, selected period bounds (`p_to` exclusive), and IANA timezone for range validation.
 * @returns Symptom counts ordered from most to least frequent.
 */
export async function getSymptomFrequency(
  client: AbstrackSupabaseClient,
  params: EpisodeInsightsRangeParams,
): Promise<PresetDataResult<SymptomFrequencyRow[]>> {
  return callInsightsRpc<SymptomFrequencyRow>(client, 'get_symptom_frequency', {
    p_user_id: params.p_user_id,
    p_from: params.p_from,
    p_to: params.p_to,
    p_timezone: params.p_timezone,
  });
}

/**
 * Loads the complete episode insights overview payload used by the web and practitioner apps.
 *
 * @param client - Supabase client with the caller JWT.
 * @param params - User, range, and IANA timezone parameters shared by the overview RPCs.
 * @returns Overview summary, heatmap buckets, symptom frequencies, and start-hour distribution.
 */
export async function loadEpisodeInsightsOverview(
  client: AbstrackSupabaseClient,
  params: EpisodeInsightsRangeParams,
): Promise<PresetDataResult<EpisodeInsightsOverviewData>> {
  const [
    summaryResult,
    weekCountsResult,
    symptomFrequencyResult,
    startHourDistributionResult,
  ] = await Promise.all([
    getEpisodeSummary(client, params),
    getEpisodeWeekCounts(client, params),
    getSymptomFrequency(client, params),
    getEpisodeStartHourDistribution(client, params),
  ]);

  if (!summaryResult.ok) {
    return summaryResult;
  }
  if (!weekCountsResult.ok) {
    return weekCountsResult;
  }
  if (!symptomFrequencyResult.ok) {
    return symptomFrequencyResult;
  }
  if (!startHourDistributionResult.ok) {
    return startHourDistributionResult;
  }

  return {
    ok: true,
    data: {
      summary: summaryResult.data,
      weekCounts: weekCountsResult.data,
      symptomFrequencies: symptomFrequencyResult.data,
      startHourDistribution: startHourDistributionResult.data,
    },
  };
}
