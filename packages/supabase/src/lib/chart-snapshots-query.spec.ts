import type { Uuid } from '@abstrack/types';
import { describe, expect, it, vi } from 'vitest';
import { PresetDataError } from './preset-data-error.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';
import {
  listUnseenChartSnapshotsForPatient,
  markChartSnapshotSeen,
  shareChartSnapshot,
  type ChartSnapshotRow,
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

const CHART_SNAPSHOTS_SELECT =
  'id, patient_user_id, practitioner_user_id, series_definition, date_from, date_to, bucket, practitioner_note, created_at, seen_by_patient_at';

const UNSEEN_SNAPSHOT_ROW: ChartSnapshotRow = {
  id: SNAPSHOT_ID,
  patient_user_id: PATIENT_ID,
  practitioner_user_id: 'cccccccc-bbbb-cccc-dddd-111111111111',
  series_definition: SERIES_DEFINITION,
  date_from: DATE_FROM,
  date_to: DATE_TO,
  bucket: 'week',
  practitioner_note: 'Check this trend',
  created_at: '2026-05-01T12:00:00.000Z',
  seen_by_patient_at: null,
};

function chartSnapshotsQueryClient(
  rows: ChartSnapshotRow[] | null,
  error: { message: string } | null = null,
) {
  const order = vi.fn(async () => ({ data: rows, error }));
  const is = vi.fn(() => ({ order }));
  const select = vi.fn(() => ({ is }));
  const from = vi.fn(() => ({ select }));

  return {
    client: { from } as unknown as AbstrackSupabaseClient,
    from,
    select,
    is,
    order,
  };
}

describe('listUnseenChartSnapshotsForPatient', () => {
  it('queries chart_snapshots for unseen rows newest first', async () => {
    const { client, from, select, is, order } = chartSnapshotsQueryClient([
      UNSEEN_SNAPSHOT_ROW,
    ]);

    await listUnseenChartSnapshotsForPatient(client);

    expect(from).toHaveBeenCalledWith('chart_snapshots');
    expect(select).toHaveBeenCalledWith(CHART_SNAPSHOTS_SELECT);
    expect(is).toHaveBeenCalledWith('seen_by_patient_at', null);
    expect(order).toHaveBeenCalledWith('created_at', { ascending: false });
  });

  it('returns query rows on success', async () => {
    const { client } = chartSnapshotsQueryClient([UNSEEN_SNAPSHOT_ROW]);

    const result = await listUnseenChartSnapshotsForPatient(client);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toEqual([UNSEEN_SNAPSHOT_ROW]);
  });

  it('returns an empty array when data is null', async () => {
    const { client } = chartSnapshotsQueryClient(null);

    const result = await listUnseenChartSnapshotsForPatient(client);

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data).toEqual([]);
  });

  it('returns ok: false when the query returns an error', async () => {
    const { client } = chartSnapshotsQueryClient(null, {
      message: 'permission denied for table chart_snapshots',
    });

    const result = await listUnseenChartSnapshotsForPatient(client);

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }

    expect(result.error).toBeInstanceOf(PresetDataError);
    expect(result.error.code).toBe('permission_denied');
  });
});

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
