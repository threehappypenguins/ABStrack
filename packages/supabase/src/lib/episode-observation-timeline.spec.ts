import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PRESET_HEALTH_MARKER_KIND_LABELS,
  type EpisodeSymptomRow,
  type FoodDiaryEntryRow,
  type HealthMarkerRow,
} from '@abstrack/types';
import {
  listEpisodeObservationTimeline,
  mergeEpisodeObservationRowsToTimeline,
  mergeStandaloneHealthAndFoodRowsToTimeline,
} from './episode-observation-timeline.js';
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

  it('reuses prefetched health markers when provided', async () => {
    listEpisodeSymptomsForEpisode.mockResolvedValue({
      ok: true,
      data: [],
    });
    listFoodDiaryEntriesForEpisode.mockResolvedValue({
      ok: true,
      data: [],
    });

    const result = await listEpisodeObservationTimeline(
      {} as AbstrackSupabaseClient,
      'ep-1',
      {
        prefetchedHealthMarkers: [
          {
            id: 'hm-prefetched',
            user_id: 'user-1',
            episode_id: 'ep-1',
            preset_health_marker_id: 'phm-1',
            marker_kind: 'heart_rate',
            custom_name: null,
            custom_name_key: null,
            custom_unit: null,
            custom_unit_key: null,
            value_numeric: 72,
            systolic_numeric: null,
            diastolic_numeric: null,
            notes: null,
            recorded_at: '2026-04-24T10:00:00.000Z',
            created_at: '2026-04-24T10:00:00.000Z',
            updated_at: '2026-04-24T10:00:00.000Z',
          },
        ] satisfies HealthMarkerRow[],
      },
    );

    expect(result.ok).toBe(true);
    expect(listEpisodeHealthMarkersForEpisode).not.toHaveBeenCalled();
    if (!result.ok) {
      return;
    }
    expect(result.data.map((r) => r.id)).toContain('hm-prefetched');
  });

  it('keeps symptom timeline rows when preset_symptom_id is null', async () => {
    listEpisodeSymptomsForEpisode.mockResolvedValue({
      ok: true,
      data: [
        {
          id: 'sym-null-link',
          preset_symptom_id: null,
          symptom_name: 'Legacy symptom',
          response_type: 'free_text',
          response_boolean: null,
          response_severity: null,
          response_text: 'Still include me',
          created_at: '2026-04-24T12:00:00.000Z',
        },
      ],
    });
    listEpisodeHealthMarkersForEpisode.mockResolvedValue({
      ok: true,
      data: [],
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
    expect(result.data).toEqual([
      {
        kind: 'symptom',
        sortAt: '2026-04-24T12:00:00.000Z',
        id: 'sym-null-link',
        label: 'Legacy symptom',
        detail: 'Still include me',
      },
    ]);
  });
});

describe('mergeEpisodeObservationRowsToTimeline', () => {
  it('preserves full free-text symptoms, marker notes, and food notes (no merge-time truncation)', () => {
    const longSymptom = 's'.repeat(200);
    const longNotes = 'n'.repeat(150);
    const longFood = 'f'.repeat(120);

    const symptom: EpisodeSymptomRow = {
      id: 'sym-long',
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      episode_id: 'eeeeeeee-bbbb-cccc-dddd-aaaaaaaaaaaa',
      preset_symptom_id: null,
      symptom_name: 'Free note',
      response_type: 'free_text',
      response_boolean: null,
      response_severity: null,
      response_text: longSymptom,
      sort_order: 0,
      created_at: '2026-04-24T12:00:00.000Z',
      updated_at: '2026-04-24T12:00:00.000Z',
    };

    const hm: HealthMarkerRow = {
      id: 'hm-long',
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      episode_id: 'eeeeeeee-bbbb-cccc-dddd-aaaaaaaaaaaa',
      preset_health_marker_id: null,
      marker_kind: 'custom',
      custom_name: null,
      custom_name_key: null,
      custom_unit: null,
      custom_unit_key: null,
      value_numeric: null,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: longNotes,
      recorded_at: '2026-04-24T11:00:00.000Z',
      created_at: '2026-04-24T11:00:00.000Z',
      updated_at: '2026-04-24T11:00:00.000Z',
    };

    const fd: FoodDiaryEntryRow = {
      id: 'fd-long',
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      episode_id: 'eeeeeeee-bbbb-cccc-dddd-aaaaaaaaaaaa',
      meal_tag: 'Lunch',
      food_note: longFood,
      logged_at: '2026-04-24T10:00:00.000Z',
      created_at: '2026-04-24T10:00:00.000Z',
      updated_at: '2026-04-24T10:00:00.000Z',
    };

    const merged = mergeEpisodeObservationRowsToTimeline([symptom], [hm], [fd]);
    expect(merged.find((r) => r.id === 'sym-long')?.detail).toBe(longSymptom);
    expect(merged.find((r) => r.id === 'hm-long')?.detail).toBe(longNotes);
    expect(merged.find((r) => r.id === 'fd-long')?.detail).toBe(longFood);
  });
});

describe('mergeStandaloneHealthAndFoodRowsToTimeline', () => {
  it('uses id as tie-breaker when marker and food share the same instant', () => {
    const hm: HealthMarkerRow = {
      id: 'marker-b',
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      episode_id: null,
      preset_health_marker_id: null,
      marker_kind: 'heart_rate',
      custom_name: null,
      custom_name_key: null,
      custom_unit: null,
      custom_unit_key: null,
      value_numeric: 72,
      systolic_numeric: null,
      diastolic_numeric: null,
      recorded_at: '2026-04-24T12:00:00.000Z',
      notes: null,
      created_at: '2026-04-24T12:00:00.000Z',
      updated_at: '2026-04-24T12:00:00.000Z',
    };
    const food: FoodDiaryEntryRow = {
      id: 'food-a',
      user_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      episode_id: null,
      meal_tag: 'Lunch',
      food_note: 'Soup',
      logged_at: '2026-04-24T12:00:00.000Z',
      created_at: '2026-04-24T12:00:00.000Z',
      updated_at: '2026-04-24T12:00:00.000Z',
    };

    const items = mergeStandaloneHealthAndFoodRowsToTimeline([hm], [food]);
    expect(items.map((r) => r.id)).toEqual(['food-a', 'marker-b']);
  });
});
