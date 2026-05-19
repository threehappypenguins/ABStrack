import { describe, expect, it, vi } from 'vitest';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  markChartSnapshotSeen,
  shareChartSnapshot,
  type ChartSnapshotSeriesDefinition,
} from './chart-snapshots-query.js';

const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const SNAPSHOT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';

const SERIES: ChartSnapshotSeriesDefinition[] = [
  {
    seriesId: 'health_marker::bac',
    seriesType: 'health_marker',
    responseType: 'numeric',
    isBloodPressure: false,
    label: 'BAC',
    unit: '%',
    chartType: 'line',
    color: '#2563eb',
  },
];

function rpcClient(
  data: unknown,
  error: { message: string } | null = null,
): AbstrackSupabaseClient {
  return {
    rpc: vi.fn().mockResolvedValue({ data, error }),
  } as unknown as AbstrackSupabaseClient;
}

describe('shareChartSnapshot', () => {
  it('calls share_chart_snapshot RPC with expected payload', async () => {
    const client = rpcClient(SNAPSHOT_ID);

    await shareChartSnapshot(client, {
      patientUserId: PATIENT_ID,
      seriesDefinition: SERIES,
      dateFrom: '2026-04-01T00:00:00.000Z',
      dateTo: '2026-05-01T00:00:00.000Z',
      bucket: 'day',
      practitionerNote: '  Trend looks stable.  ',
    });

    expect(client.rpc).toHaveBeenCalledWith('share_chart_snapshot', {
      p_patient_user_id: PATIENT_ID,
      p_series_definition: SERIES,
      p_date_from: '2026-04-01T00:00:00.000Z',
      p_date_to: '2026-05-01T00:00:00.000Z',
      p_bucket: 'day',
      p_practitioner_note: '  Trend looks stable.  ',
    });
  });

  it('returns snapshot id on success', async () => {
    const result = await shareChartSnapshot(rpcClient(SNAPSHOT_ID), {
      patientUserId: PATIENT_ID,
      seriesDefinition: SERIES,
      dateFrom: '2026-04-01T00:00:00.000Z',
      dateTo: '2026-05-01T00:00:00.000Z',
      bucket: 'week',
    });

    expect(result).toEqual({ ok: true, data: SNAPSHOT_ID });
  });
});

describe('markChartSnapshotSeen', () => {
  it('calls mark_chart_snapshot_seen RPC with snapshot id', async () => {
    const client = rpcClient(true);

    await markChartSnapshotSeen(client, SNAPSHOT_ID);

    expect(client.rpc).toHaveBeenCalledWith('mark_chart_snapshot_seen', {
      p_snapshot_id: SNAPSHOT_ID,
    });
  });
});
