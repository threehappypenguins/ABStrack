import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import { PresetDataError } from './preset-data-error.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  markChartSnapshotSeen,
  shareChartSnapshot,
  type ChartSnapshotSeriesDefinition,
  type ShareChartSnapshotParams,
} from './chart-snapshots-query.js';

const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' as Uuid;
const SNAPSHOT_ID = 'bbbbbbbb-bbbb-cccc-dddd-ffffffffffff' as Uuid;
const DATE_FROM = '2026-01-01T05:00:00.000Z';
const DATE_TO = '2026-02-01T05:00:00.000Z';

const SERIES_DEFINITION: ChartSnapshotSeriesDefinition[] = [
  {
    seriesId: 'health_marker::bac',
    seriesType: 'health_marker',
    responseType: 'numeric',
    isBloodPressure: false,
    label: 'BAC',
    unit: '%',
    chartType: 'line',
    color: '#1d4ed8',
  },
];

const SHARE_PARAMS: ShareChartSnapshotParams = {
  patientUserId: PATIENT_ID,
  seriesDefinition: SERIES_DEFINITION,
  dateFrom: DATE_FROM,
  dateTo: DATE_TO,
  bucket: 'week',
  practitionerNote: '  Check this trend  ',
};

describe('shareChartSnapshot', () => {
  it('calls share_chart_snapshot RPC with snake_case payload', async () => {
    const rpc = vi.fn(async () => ({ data: SNAPSHOT_ID, error: null }));
    const client = { rpc } as unknown as AbstrackSupabaseClient;

    await shareChartSnapshot(client, SHARE_PARAMS);

    expect(rpc).toHaveBeenCalledWith('share_chart_snapshot', {
      p_patient_user_id: PATIENT_ID,
      p_series_definition: SERIES_DEFINITION,
      p_date_from: DATE_FROM,
      p_date_to: DATE_TO,
      p_bucket: 'week',
      p_practitioner_note: 'Check this trend',
    });
  });

  it('omits practitioner note when blank after trim', async () => {
    const rpc = vi.fn(async () => ({ data: SNAPSHOT_ID, error: null }));
    const client = { rpc } as unknown as AbstrackSupabaseClient;

    await shareChartSnapshot(client, {
      ...SHARE_PARAMS,
      practitionerNote: '   ',
    });

    expect(rpc).toHaveBeenCalledWith('share_chart_snapshot', {
      p_patient_user_id: PATIENT_ID,
      p_series_definition: SERIES_DEFINITION,
      p_date_from: DATE_FROM,
      p_date_to: DATE_TO,
      p_bucket: 'week',
      p_practitioner_note: undefined,
    });
  });

  it('returns ok: false when rpc returns an error', async () => {
    const rpc = vi.fn(async () => ({
      data: null,
      error: { message: 'permission denied for function share_chart_snapshot' },
    }));
    const client = { rpc } as unknown as AbstrackSupabaseClient;

    const result = await shareChartSnapshot(client, SHARE_PARAMS);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toBeInstanceOf(PresetDataError);
    expect(result.error.code).toBe('permission_denied');
  });
});

describe('markChartSnapshotSeen', () => {
  it('calls mark_chart_snapshot_seen RPC with snapshot id', async () => {
    const rpc = vi.fn(async () => ({ data: true, error: null }));
    const client = { rpc } as unknown as AbstrackSupabaseClient;

    await markChartSnapshotSeen(client, SNAPSHOT_ID);

    expect(rpc).toHaveBeenCalledWith('mark_chart_snapshot_seen', {
      p_snapshot_id: SNAPSHOT_ID,
    });
  });

  it('returns boolean from RPC data', async () => {
    const rpc = vi.fn(async () => ({ data: false, error: null }));
    const client = { rpc } as unknown as AbstrackSupabaseClient;

    const result = await markChartSnapshotSeen(client, SNAPSHOT_ID);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toBe(false);
  });
});
