import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  getChartSeries,
  type ChartSeriesBucketRow,
  type ChartSeriesSelection,
  type GetChartSeriesParams,
} from './chart-series-query.js';

const USER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as Uuid;
const FROM = '2026-01-01T00:00:00.000Z';
const TO = '2026-03-01T00:00:00.000Z';

const SERIES: ChartSeriesSelection[] = [
  {
    series_id: 'health_marker::blood_pressure',
    series_type: 'health_marker',
    response_type: 'numeric',
    is_blood_pressure: true,
  },
];

const PARAMS: GetChartSeriesParams = {
  p_user_id: USER_ID,
  p_series: SERIES,
  p_from: FROM,
  p_to: TO,
  p_bucket: 'week',
};

function chartSeriesClient(rows: ChartSeriesBucketRow[]) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return {
    rpc,
  } as unknown as AbstrackSupabaseClient;
}

describe('getChartSeries', () => {
  it('calls get_chart_series RPC with user, series, range, and bucket', async () => {
    const client = chartSeriesClient([]);

    await getChartSeries(client, PARAMS);

    expect(client.rpc).toHaveBeenCalledWith('get_chart_series', PARAMS);
  });

  it('returns RPC rows unchanged', async () => {
    const rows: ChartSeriesBucketRow[] = [
      {
        series_id: 'health_marker::blood_pressure',
        bucket_start: '2026-01-06T00:00:00.000Z',
        value_avg: null,
        value_min: null,
        value_max: null,
        systolic_avg: 128,
        diastolic_avg: 82,
        event_count: null,
      },
    ];

    const result = await getChartSeries(chartSeriesClient(rows), PARAMS);

    expect(result).toEqual(rows);
  });
});
