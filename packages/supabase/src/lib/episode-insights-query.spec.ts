import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import { PresetDataError } from './preset-data-error.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  getEpisodeStartHourDistribution,
  getEpisodeSummary,
  getEpisodeWeekCounts,
  getSymptomFrequency,
  type EpisodeInsightsRangeParams,
  type EpisodeStartHourDistributionRow,
  type EpisodeSummaryRow,
  type EpisodeWeekCountRow,
  type SymptomFrequencyRow,
} from './episode-insights-query.js';

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as Uuid;

const RANGE_PARAMS: EpisodeInsightsRangeParams = {
  p_user_id: USER_ID,
  p_from: '2026-01-01T00:00:00.000Z',
  p_to: '2026-03-01T00:00:00.000Z',
  p_timezone: 'America/New_York',
};

function rpcClient(data: unknown, error: unknown = null) {
  const rpc = vi.fn(async () => ({ data, error }));
  return {
    rpc,
  } as unknown as AbstrackSupabaseClient;
}

describe('episode insights query wrappers', () => {
  it('calls get_episode_summary with the selected range and timezone', async () => {
    const rows: EpisodeSummaryRow[] = [
      {
        total_episode_count: 3,
        abs_episode_count: 1,
        other_episode_count: 2,
        average_episodes_per_week: 1.5,
        longest_episode_free_streak_days: 6,
        current_episode_free_streak_days: 4,
        average_episode_duration_hours: 9.5,
      },
    ];
    const client = rpcClient(rows);

    const result = await getEpisodeSummary(client, RANGE_PARAMS);

    expect(client.rpc).toHaveBeenCalledWith(
      'get_episode_summary',
      RANGE_PARAMS,
    );
    expect(result).toEqual({ ok: true, data: rows[0] });
  });

  it('calls get_episode_week_counts and returns rows unchanged', async () => {
    const rows: EpisodeWeekCountRow[] = [
      {
        week_start: '2026-01-05T05:00:00.000Z',
        episode_type: 'Other',
        episode_count: 2,
      },
    ];
    const client = rpcClient(rows);

    const result = await getEpisodeWeekCounts(client, RANGE_PARAMS);

    expect(client.rpc).toHaveBeenCalledWith(
      'get_episode_week_counts',
      RANGE_PARAMS,
    );
    expect(result).toEqual({ ok: true, data: rows });
  });

  it('calls get_episode_start_hour_distribution and returns rows unchanged', async () => {
    const rows: EpisodeStartHourDistributionRow[] = [
      {
        hour_of_day: 4,
        episode_type: 'Other',
        episode_count: 7,
      },
    ];
    const client = rpcClient(rows);

    const result = await getEpisodeStartHourDistribution(client, RANGE_PARAMS);

    expect(client.rpc).toHaveBeenCalledWith(
      'get_episode_start_hour_distribution',
      RANGE_PARAMS,
    );
    expect(result).toEqual({ ok: true, data: rows });
  });

  it('calls get_symptom_frequency with timezone and returns rows unchanged', async () => {
    const rows: SymptomFrequencyRow[] = [
      {
        symptom_name: 'Nausea',
        occurrence_count: 12,
      },
    ];
    const client = rpcClient(rows);

    const result = await getSymptomFrequency(client, {
      p_user_id: RANGE_PARAMS.p_user_id,
      p_from: RANGE_PARAMS.p_from,
      p_to: RANGE_PARAMS.p_to,
      p_timezone: RANGE_PARAMS.p_timezone,
    });

    expect(client.rpc).toHaveBeenCalledWith('get_symptom_frequency', {
      p_user_id: RANGE_PARAMS.p_user_id,
      p_from: RANGE_PARAMS.p_from,
      p_to: RANGE_PARAMS.p_to,
      p_timezone: RANGE_PARAMS.p_timezone,
    });
    expect(result).toEqual({ ok: true, data: rows });
  });

  it('coalesces null row sets to empty arrays', async () => {
    const client = rpcClient(null);

    const weekCountsResult = await getEpisodeWeekCounts(client, RANGE_PARAMS);
    const symptomResult = await getSymptomFrequency(client, RANGE_PARAMS);

    expect(weekCountsResult).toEqual({ ok: true, data: [] });
    expect(symptomResult).toEqual({ ok: true, data: [] });
  });

  it('returns null when get_episode_summary returns no rows', async () => {
    const client = rpcClient(null);

    const result = await getEpisodeSummary(client, RANGE_PARAMS);

    expect(result).toEqual({ ok: true, data: null });
  });

  it('maps rpc errors to PresetDataError', async () => {
    const client = rpcClient(null, {
      message: 'permission denied for function get_episode_summary',
    });

    const result = await getEpisodeSummary(client, RANGE_PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toBeInstanceOf(PresetDataError);
    expect(result.error.code).toBe('permission_denied');
  });
});
