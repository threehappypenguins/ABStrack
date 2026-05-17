import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  getUserChartManifest,
  type UserChartManifestSeries,
} from './chart-manifest-data.js';

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

  it('returns rows including is_blood_pressure on each series', async () => {
    const rows: UserChartManifestSeries[] = [
      {
        series_id: 'health_marker::bac',
        series_type: 'health_marker',
        label: 'bac',
        response_type: 'numeric',
        is_blood_pressure: false,
        unit: null,
        observation_count: 3,
        first_observed_at: '2026-01-01T00:00:00.000Z',
        last_observed_at: '2026-02-01T00:00:00.000Z',
      },
      {
        series_id: 'health_marker::blood_pressure',
        series_type: 'health_marker',
        label: 'blood_pressure',
        response_type: 'numeric',
        is_blood_pressure: true,
        unit: null,
        observation_count: 2,
        first_observed_at: '2026-01-05T00:00:00.000Z',
        last_observed_at: '2026-01-10T00:00:00.000Z',
      },
      {
        series_id: 'symptom::headache::severity',
        series_type: 'symptom',
        label: 'Headache',
        response_type: 'severity',
        is_blood_pressure: false,
        unit: null,
        observation_count: 1,
        first_observed_at: '2026-01-15T00:00:00.000Z',
        last_observed_at: '2026-01-15T00:00:00.000Z',
      },
    ];

    const result = await getUserChartManifest(manifestClient(rows), USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toHaveLength(3);
    for (const series of result.data) {
      expect(series).toHaveProperty('is_blood_pressure');
      expect(typeof series.is_blood_pressure).toBe('boolean');
    }

    const bloodPressure = result.data.find(
      (s) => s.series_id === 'health_marker::blood_pressure',
    );
    expect(bloodPressure).toMatchObject({
      response_type: 'numeric',
      is_blood_pressure: true,
    });

    for (const symptom of result.data.filter(
      (s) => s.series_type === 'symptom',
    )) {
      expect(symptom.is_blood_pressure).toBe(false);
    }
  });

  it('returns RPC rows unchanged (non-chartable symptom exclusion is enforced in SQL)', async () => {
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
      {
        series_id: 'symptom::journal note',
        series_type: 'symptom',
        label: 'Journal note',
        response_type: 'text',
        is_blood_pressure: false,
        unit: null,
        observation_count: 1,
        first_observed_at: '2026-02-01T00:00:00.000Z',
        last_observed_at: '2026-02-01T00:00:00.000Z',
      },
    ];

    const result = await getUserChartManifest(manifestClient(rows), USER_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toEqual(rows);
  });
});
