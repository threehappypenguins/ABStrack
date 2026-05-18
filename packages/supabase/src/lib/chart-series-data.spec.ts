import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  getChartSeries,
  type ChartSeriesBucketRow,
  type ChartSeriesSelection,
} from './chart-series-data.js';

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

function chartSeriesClient(rows: ChartSeriesBucketRow[]) {
  const rpc = vi.fn(async () => ({ data: rows, error: null }));
  return {
    rpc,
  } as unknown as AbstrackSupabaseClient;
}

describe('getChartSeries', () => {
  it('calls get_chart_series RPC with user, series, range, and bucket', async () => {
    const client = chartSeriesClient([]);

    await getChartSeries(client, USER_ID, SERIES, FROM, TO, 'week');

    expect(client.rpc).toHaveBeenCalledWith('get_chart_series', {
      p_user_id: USER_ID,
      p_series: SERIES,
      p_from: FROM,
      p_to: TO,
      p_bucket: 'week',
    });
  });

  it('returns blood pressure buckets with systolic/diastolic averages and null value_*', async () => {
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

    const result = await getChartSeries(
      chartSeriesClient(rows),
      USER_ID,
      SERIES,
      FROM,
      TO,
      'week',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toEqual(rows);
    const bucket = result.data[0];
    expect(bucket.value_avg).toBeNull();
    expect(bucket.value_min).toBeNull();
    expect(bucket.value_max).toBeNull();
    expect(bucket.systolic_avg).toBe(128);
    expect(bucket.diastolic_avg).toBe(82);
    expect(bucket.event_count).toBeNull();
  });

  it('returns numeric buckets with value_avg/min/max and null blood pressure columns', async () => {
    const rows: ChartSeriesBucketRow[] = [
      {
        series_id: 'health_marker::bac',
        bucket_start: '2026-01-01T00:00:00.000Z',
        value_avg: 0.04,
        value_min: 0.02,
        value_max: 0.06,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: null,
      },
    ];

    const result = await getChartSeries(
      chartSeriesClient(rows),
      USER_ID,
      [
        {
          series_id: 'health_marker::bac',
          series_type: 'health_marker',
          response_type: 'numeric',
          is_blood_pressure: false,
        },
      ],
      FROM,
      TO,
      'day',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bucket = result.data[0];
    expect(bucket.value_avg).toBe(0.04);
    expect(bucket.value_min).toBe(0.02);
    expect(bucket.value_max).toBe(0.06);
    expect(bucket.systolic_avg).toBeNull();
    expect(bucket.diastolic_avg).toBeNull();
    expect(bucket.event_count).toBeNull();
  });

  it('returns boolean buckets with event_count only (other value columns null)', async () => {
    const rows: ChartSeriesBucketRow[] = [
      {
        series_id: 'symptom::fatigue::boolean',
        bucket_start: '2026-02-01T00:00:00.000Z',
        value_avg: null,
        value_min: null,
        value_max: null,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: 3,
      },
    ];

    const result = await getChartSeries(
      chartSeriesClient(rows),
      USER_ID,
      [
        {
          series_id: 'symptom::fatigue::boolean',
          series_type: 'symptom',
          response_type: 'boolean',
          is_blood_pressure: false,
        },
      ],
      FROM,
      TO,
      'month',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bucket = result.data[0];
    expect(bucket.event_count).toBe(3);
    expect(bucket.value_avg).toBeNull();
    expect(bucket.value_min).toBeNull();
    expect(bucket.value_max).toBeNull();
    expect(bucket.systolic_avg).toBeNull();
    expect(bucket.diastolic_avg).toBeNull();
  });

  it('returns severity buckets with value_avg/min/max, event_count, and null blood pressure columns', async () => {
    const rows: ChartSeriesBucketRow[] = [
      {
        series_id: 'symptom::headache::severity',
        bucket_start: '2026-01-15T00:00:00.000Z',
        value_avg: 3,
        value_min: 2,
        value_max: 4,
        systolic_avg: null,
        diastolic_avg: null,
        event_count: 5,
      },
    ];

    const result = await getChartSeries(
      chartSeriesClient(rows),
      USER_ID,
      [
        {
          series_id: 'symptom::headache::severity',
          series_type: 'symptom',
          response_type: 'severity',
          is_blood_pressure: false,
        },
      ],
      FROM,
      TO,
      'week',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    const bucket = result.data[0];
    expect(bucket.value_avg).toBe(3);
    expect(bucket.value_min).toBe(2);
    expect(bucket.value_max).toBe(4);
    expect(bucket.event_count).toBe(5);
    expect(bucket.systolic_avg).toBeNull();
    expect(bucket.diastolic_avg).toBeNull();
  });
});
