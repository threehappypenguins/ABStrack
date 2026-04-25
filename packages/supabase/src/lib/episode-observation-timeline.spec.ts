import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PRESET_HEALTH_MARKER_KIND_LABELS } from '@abstrack/types';
import { listEpisodeObservationTimeline } from './episode-observation-timeline.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const listEpisodeSymptomsForEpisode = vi.hoisted(() => vi.fn());
const listEpisodeHealthMarkersForEpisode = vi.hoisted(() => vi.fn());
const listFoodDiaryEntriesForEpisode = vi.hoisted(() => vi.fn());

vi.mock('./episode-symptom-data.js', () => ({
  listEpisodeSymptomsForEpisode,
}));

vi.mock('./episode-health-marker-data.js', () => ({
  listEpisodeHealthMarkersForEpisode,
}));

vi.mock('./food-diary-data.js', () => ({
  listFoodDiaryEntriesForEpisode,
}));

describe('listEpisodeObservationTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sorts oldest first by parsed timestamp across mixed ISO formats', async () => {
    listEpisodeSymptomsForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sym-1',
          preset_symptom_id: 'ps-1',
          symptom_name: 'Nausea',
          response_type: 'yes_no',
          response_boolean: true,
          response_severity: null,
          response_text: null,
          created_at: '2026-04-24T12:00:00.9Z',
        },
      ],
    });
    listEpisodeHealthMarkersForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'hm-1',
          marker_kind: 'heart_rate',
          custom_name: null,
          custom_unit: null,
          value_numeric: 90,
          systolic_numeric: null,
          diastolic_numeric: null,
          notes: null,
          recorded_at: '2026-04-24T12:00:00.123+00:00',
        },
      ],
    });
    listFoodDiaryEntriesForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'fd-1',
          meal_tag: 'Lunch',
          food_note: 'Soup',
          logged_at: '2026-04-24T12:00:00.023Z',
        },
      ],
    });

    const result = await listEpisodeObservationTimeline(
      {} as AbstrackSupabaseClient,
      'ep-1',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.map((r) => r.id)).toEqual(['fd-1', 'hm-1', 'sym-1']);
    expect(result.data.find((r) => r.id === 'hm-1')?.label).toBe(
      PRESET_HEALTH_MARKER_KIND_LABELS.heart_rate,
    );
  });

  it('uses id as tie-breaker when timestamps are equal instants', async () => {
    listEpisodeSymptomsForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'b-id',
          preset_symptom_id: 'ps-1',
          symptom_name: 'Headache',
          response_type: 'yes_no',
          response_boolean: false,
          response_severity: null,
          response_text: null,
          created_at: '2026-04-24T12:00:00.000Z',
        },
      ],
    });
    listEpisodeHealthMarkersForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'a-id',
          marker_kind: 'heart_rate',
          custom_name: null,
          custom_unit: null,
          value_numeric: 70,
          systolic_numeric: null,
          diastolic_numeric: null,
          notes: null,
          recorded_at: '2026-04-24T12:00:00+00:00',
        },
      ],
    });
    listFoodDiaryEntriesForEpisode.mockResolvedValue({
      ok: true,
      data: [],
    });

    const result = await listEpisodeObservationTimeline(
      {} as AbstrackSupabaseClient,
      'ep-1',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.map((r) => r.id)).toEqual(['a-id', 'b-id']);
  });

  it('merges mixed kinds and applies id tie-break across same-time rows', async () => {
    listEpisodeSymptomsForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'id-c',
          preset_symptom_id: 'ps-1',
          symptom_name: 'Cramping',
          response_type: 'yes_no',
          response_boolean: true,
          response_severity: null,
          response_text: null,
          created_at: '2026-04-24T12:00:00Z',
        },
      ],
    });
    listEpisodeHealthMarkersForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'id-a',
          marker_kind: 'heart_rate',
          custom_name: null,
          custom_unit: null,
          value_numeric: 88,
          systolic_numeric: null,
          diastolic_numeric: null,
          notes: null,
          recorded_at: '2026-04-24T12:00:00.000+00:00',
        },
      ],
    });
    listFoodDiaryEntriesForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'id-b',
          meal_tag: 'Dinner',
          food_note: 'Rice bowl',
          logged_at: '2026-04-24T12:00:00.000Z',
        },
      ],
    });

    const result = await listEpisodeObservationTimeline(
      {} as AbstrackSupabaseClient,
      'ep-1',
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.map((r) => `${r.id}:${r.kind}`)).toEqual([
      'id-a:health_marker',
      'id-b:food',
      'id-c:symptom',
    ]);
  });
});
