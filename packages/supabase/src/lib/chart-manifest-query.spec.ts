import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  getUserChartManifest,
  type UserChartManifestSeries,
} from './chart-manifest-query.js';

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as Uuid;

function manifestClient(rows: UserChartManifestSeries[]) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return {
    rpc,
  } as unknown as AbstrackSupabaseClient;
}

describe('getUserChartManifest', () => {
  it('calls get_user_chart_manifest RPC with p_user_id', async () => {
    const client = manifestClient([]);

    await getUserChartManifest(client, USER_ID);

    expect(client.rpc).toHaveBeenCalledWith('get_user_chart_manifest', {
      p_user_id: USER_ID,
    });
  });

  it('returns RPC rows unchanged', async () => {
    const rows: UserChartManifestSeries[] = [
      {
        series_id: 'symptom::fatigue::boolean',
        series_type: 'symptom',
        label: 'Fatigue',
        response_type: 'boolean',
        is_blood_pressure: false,
        unit: null,
        observation_count: 4,
        first_observed_at: '2026-01-01T00:00:00.000Z',
        last_observed_at: '2026-03-01T00:00:00.000Z',
      },
    ];

    const result = await getUserChartManifest(manifestClient(rows), USER_ID);

    expect(result).toEqual(rows);
  });
});
