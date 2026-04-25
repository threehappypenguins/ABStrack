import { describe, expect, it } from 'vitest';
import type { EpisodeSymptomRow } from './types.js';
import {
  compareEpisodeSymptomRowsForHistory,
  formatEpisodeSymptomHistoryDetail,
} from './episode-symptom-history.js';

function makeRow(
  id: string,
  createdAt: string,
  responseType: EpisodeSymptomRow['response_type'],
): EpisodeSymptomRow {
  return {
    id,
    user_id: 'u-1',
    episode_id: 'ep-1',
    preset_symptom_id: 'ps-1',
    symptom_name: 'Nausea',
    response_type: responseType,
    response_boolean: null,
    response_severity: null,
    response_text: null,
    sort_order: 0,
    created_at: createdAt,
    updated_at: createdAt,
  };
}

describe('compareEpisodeSymptomRowsForHistory', () => {
  it('sorts oldest first by parsed created_at across mixed ISO formats', () => {
    const rows = [
      makeRow('r3', '2026-04-24T12:00:00.900Z', 'yes_no'),
      makeRow('r1', '2026-04-24T12:00:00.123+00:00', 'yes_no'),
      makeRow('r2', '2026-04-24T12:00:00.523Z', 'yes_no'),
    ];

    rows.sort(compareEpisodeSymptomRowsForHistory);
    expect(rows.map((r) => r.id)).toEqual(['r1', 'r2', 'r3']);
  });

  it('uses id as tie-breaker when timestamps are equal instants', () => {
    const rows = [
      makeRow('b-id', '2026-04-24T12:00:00.000Z', 'yes_no'),
      makeRow('a-id', '2026-04-24T12:00:00+00:00', 'yes_no'),
    ];

    rows.sort(compareEpisodeSymptomRowsForHistory);
    expect(rows.map((r) => r.id)).toEqual(['a-id', 'b-id']);
  });
});

describe('formatEpisodeSymptomHistoryDetail', () => {
  it('formats yes_no and falls back when response_boolean is null', () => {
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('yes', '2026-04-24T12:00:00.000Z', 'yes_no'),
        response_boolean: true,
      }),
    ).toBe('Yes');
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('no', '2026-04-24T12:00:00.000Z', 'yes_no'),
        response_boolean: false,
      }),
    ).toBe('No');
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('null', '2026-04-24T12:00:00.000Z', 'yes_no'),
        response_boolean: null,
      }),
    ).toBe('—');
  });

  it('formats severity and falls back when response_severity is null', () => {
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('sev', '2026-04-24T12:00:00.000Z', 'severity_scale'),
        response_severity: 5,
      }),
    ).toBe('Severity 5');
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('sev-null', '2026-04-24T12:00:00.000Z', 'severity_scale'),
        response_severity: null,
      }),
    ).toBe('—');
  });

  it('formats free_text and trims/handles empty text', () => {
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('text', '2026-04-24T12:00:00.000Z', 'free_text'),
        response_text: '  severe nausea  ',
      }),
    ).toBe('severe nausea');
    expect(
      formatEpisodeSymptomHistoryDetail({
        ...makeRow('text-empty', '2026-04-24T12:00:00.000Z', 'free_text'),
        response_text: '   ',
      }),
    ).toBe('—');
  });

  it('formats media response types', () => {
    expect(
      formatEpisodeSymptomHistoryDetail(
        makeRow('photo', '2026-04-24T12:00:00.000Z', 'photo'),
      ),
    ).toBe('Photo');
    expect(
      formatEpisodeSymptomHistoryDetail(
        makeRow('video', '2026-04-24T12:00:00.000Z', 'video'),
      ),
    ).toBe('Video');
  });
});
