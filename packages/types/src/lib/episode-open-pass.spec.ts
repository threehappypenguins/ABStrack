import { describe, expect, it } from 'vitest';
import type {
  EpisodeSymptomRow,
  HealthMarkerRow,
  PresetHealthMarkerRow,
} from './types.js';
import {
  filterEpisodeSymptomRowsForOpenPass,
  filterHealthMarkerRowsForOpenPass,
  findLatestHealthMarkerForLineInPass,
} from './episode-open-pass.js';

function makeSymptomRow(id: string, createdAt: string): EpisodeSymptomRow {
  return {
    id,
    user_id: 'u-1',
    episode_id: 'ep-1',
    preset_symptom_id: 'ps-1',
    symptom_name: 'Nausea',
    response_type: 'yes_no',
    response_boolean: true,
    response_severity: null,
    response_text: null,
    sort_order: 0,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

function makeHealthMarkerRow(id: string, createdAt: string): HealthMarkerRow {
  return {
    id,
    user_id: 'u-1',
    episode_id: 'ep-1',
    preset_health_marker_id: 'phm-1',
    marker_kind: 'heart_rate',
    custom_name: null,
    custom_name_key: null,
    custom_unit: null,
    custom_unit_key: null,
    value_numeric: 90,
    systolic_numeric: null,
    diastolic_numeric: null,
    notes: null,
    recorded_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

const markerLine: PresetHealthMarkerRow = {
  id: 'phm-1',
  preset_id: 'hm-preset-1',
  sort_order: 0,
  marker_kind: 'heart_rate',
  custom_name: null,
  custom_unit: null,
  created_at: '2026-04-24T00:00:00.000Z',
  updated_at: '2026-04-24T00:00:00.000Z',
};

describe('filterEpisodeSymptomRowsForOpenPass', () => {
  it('uses parsed timestamps for pass-boundary filtering across mixed formats', () => {
    const boundary = '2026-04-24T12:00:00.123+00:00';
    const rows = [
      makeSymptomRow('before', '2026-04-24T12:00:00.100Z'),
      makeSymptomRow('at', '2026-04-24T12:00:00.123Z'),
      makeSymptomRow('after', '2026-04-24T12:00:00.124Z'),
    ];

    const filtered = filterEpisodeSymptomRowsForOpenPass(rows, boundary);
    expect(filtered.map((r) => r.id)).toEqual(['after']);
  });
});

describe('filterHealthMarkerRowsForOpenPass', () => {
  it('uses parsed timestamps for pass-boundary filtering across mixed formats', () => {
    const boundary = '2026-04-24T12:00:00.500+00:00';
    const rows = [
      makeHealthMarkerRow('before', '2026-04-24T12:00:00.499Z'),
      makeHealthMarkerRow('at', '2026-04-24T12:00:00.500Z'),
      makeHealthMarkerRow('after', '2026-04-24T12:00:00.501Z'),
    ];

    const filtered = filterHealthMarkerRowsForOpenPass(rows, boundary);
    expect(filtered.map((r) => r.id)).toEqual(['after']);
  });
});

describe('findLatestHealthMarkerForLineInPass', () => {
  it('chooses latest by parsed recorded_at with mixed timestamp formats', () => {
    const rows: HealthMarkerRow[] = [
      {
        ...makeHealthMarkerRow('older', '2026-04-24T12:00:00.100Z'),
        recorded_at: '2026-04-24T12:00:00.100Z',
      },
      {
        ...makeHealthMarkerRow('newer', '2026-04-24T12:00:00.000Z'),
        recorded_at: '2026-04-24T12:00:00.123+00:00',
      },
    ];

    const latest = findLatestHealthMarkerForLineInPass(rows, markerLine);
    expect(latest?.id).toBe('newer');
  });

  it('uses created_at then id tie-break when recorded_at instants match', () => {
    const rows: HealthMarkerRow[] = [
      {
        ...makeHealthMarkerRow('b-id', '2026-04-24T12:00:00.700Z'),
        recorded_at: '2026-04-24T12:00:00.500Z',
      },
      {
        ...makeHealthMarkerRow('a-id', '2026-04-24T12:00:00.700+00:00'),
        recorded_at: '2026-04-24T12:00:00.500+00:00',
      },
    ];

    const latest = findLatestHealthMarkerForLineInPass(rows, markerLine);
    expect(latest?.id).toBe('b-id');
  });
});
