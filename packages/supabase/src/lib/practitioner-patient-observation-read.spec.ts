import { describe, expect, it, vi, beforeEach } from 'vitest';
import type {
  EpisodeSymptomRow,
  FoodDiaryEntryRow,
  HealthMarkerRow,
} from '@abstrack/types';
import {
  EPISODE_TIMELINE_SOURCE_LIMIT,
  episodeTimelineMeasurementDetailWithOptionalNotes,
} from './episode-observation-timeline.js';
import { PresetDataError } from './preset-data-error.js';
import {
  assertActivePractitionerGrantForPatient,
  loadPractitionerPatientObservationReadModel,
  PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK,
  PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
  PRACTITIONER_STANDALONE_OBSERVATION_CAP,
  type PractitionerPatientEpisodeRow,
} from './practitioner-patient-observation-read.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const listStandaloneHealthMarkersForUser = vi.hoisted(() => vi.fn());
const listEpisodeHealthMarkersForEpisode = vi.hoisted(() => vi.fn());
const listFoodDiaryEntriesForUser = vi.hoisted(() => vi.fn());
const listFoodDiaryEntriesForEpisode = vi.hoisted(() => vi.fn());
const listEpisodeSymptomsForEpisode = vi.hoisted(() => vi.fn());

vi.mock('./episode-health-marker-data.js', () => ({
  listStandaloneHealthMarkersForUser,
  listEpisodeHealthMarkersForEpisode,
}));

vi.mock('./episode-symptom-data.js', () => ({
  listEpisodeSymptomsForEpisode,
}));

vi.mock('./food-diary-data.js', () => ({
  listFoodDiaryEntriesForUser,
  listFoodDiaryEntriesForEpisode,
}));

const PATIENT_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

function episodeFixture(
  id: string,
  userId: string,
): PractitionerPatientEpisodeRow {
  return {
    id,
    user_id: userId,
    additional_notes: null,
    created_at: '2026-01-01T00:00:00.000Z',
    ended_at: null,
    episode_label: null,
    episode_type: 'ABS',
    health_marker_preset_id: null,
    note: null,
    post_marker_step_completed_at: null,
    started_at: '2026-01-01T10:00:00.000Z',
    symptom_preset_id: null,
    updated_at: '2026-01-01T10:00:00.000Z',
  };
}

function grantChain(row: { id: string } | null) {
  const p = Promise.resolve({ data: row, error: null });
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    is: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => p),
  };
}

function episodesAwaitableChain(result: { data: unknown; error: unknown }) {
  const p = Promise.resolve(result);
  const self = {
    select: vi.fn(() => self),
    eq: vi.fn(() => self),
    order: vi.fn(() => self),
    limit: vi.fn(() => p),
    then: (
      onFulfilled?: (v: unknown) => unknown,
      onRejected?: (e: unknown) => unknown,
    ) => p.then(onFulfilled, onRejected),
    catch: p.catch.bind(p),
    finally: p.finally.bind(p),
  };
  return self;
}

function profileChain(result: { data: unknown; error: unknown }) {
  const p = Promise.resolve(result);
  return {
    select: vi.fn().mockReturnThis(),
    eq: vi.fn().mockReturnThis(),
    maybeSingle: vi.fn(() => p),
  };
}

type ReadModelClientOpts = {
  /**
   * `practitioner_access.maybeSingle()` payload: omit for default active grant; pass `null` for no row
   * (denied path).
   */
  grant?: { id: string } | null;
  episodes: PractitionerPatientEpisodeRow[];
  episodesError?: unknown;
  profile?: { display_name: string | null };
  symptoms?: EpisodeSymptomRow[];
  markers?: HealthMarkerRow[];
  foods?: FoodDiaryEntryRow[];
  symptomsError?: unknown;
  markersError?: unknown;
  foodsError?: unknown;
  /**
   * Full replacement for the episode-symptoms list mock (default filters {@link ReadModelClientOpts.symptoms}
   * by `episode_id`). Use when a test needs custom async behavior such as concurrency instrumentation.
   */
  listEpisodeSymptomsForEpisodeOverride?: (
    client: AbstrackSupabaseClient,
    episodeId: string,
    options?: { limit?: number; orderBy?: 'preset' | 'recent' },
  ) => Promise<
    | { ok: true; data: EpisodeSymptomRow[] }
    | { ok: false; error: PresetDataError }
  >;
};

function episodeObservationListMocks(opts: ReadModelClientOpts): void {
  if (opts.listEpisodeSymptomsForEpisodeOverride != null) {
    listEpisodeSymptomsForEpisode.mockImplementation(
      opts.listEpisodeSymptomsForEpisodeOverride,
    );
  } else {
    listEpisodeSymptomsForEpisode.mockImplementation(
      async (_c, episodeId: string) => {
        if (opts.symptomsError != null) {
          const msg =
            typeof opts.symptomsError === 'object' &&
            opts.symptomsError !== null &&
            'message' in opts.symptomsError
              ? String(
                  (opts.symptomsError as { message?: unknown }).message ??
                    'symptoms failed',
                )
              : 'symptoms failed';
          return { ok: false, error: new PresetDataError('unknown', msg) };
        }
        return {
          ok: true,
          data: (opts.symptoms ?? []).filter((s) => s.episode_id === episodeId),
        };
      },
    );
  }

  listEpisodeHealthMarkersForEpisode.mockImplementation(
    async (_c, episodeId: string) => {
      if (opts.markersError != null) {
        return {
          ok: false,
          error: new PresetDataError('unknown', 'markers failed'),
        };
      }
      return {
        ok: true,
        data: (opts.markers ?? []).filter((m) => m.episode_id === episodeId),
      };
    },
  );

  listFoodDiaryEntriesForEpisode.mockImplementation(
    async (_c, episodeId: string) => {
      if (opts.foodsError != null) {
        return {
          ok: false,
          error: new PresetDataError('unknown', 'foods failed'),
        };
      }
      return {
        ok: true,
        data: (opts.foods ?? []).filter((f) => f.episode_id === episodeId),
      };
    },
  );
}

function clientForReadModel(opts: ReadModelClientOpts): AbstrackSupabaseClient {
  episodeObservationListMocks(opts);

  const from = vi.fn((table: string) => {
    if (table === 'practitioner_access') {
      const grantRow =
        opts.grant === undefined ? { id: 'grant-1' } : opts.grant;
      return grantChain(grantRow);
    }
    if (table === 'episodes') {
      if (opts.episodesError != null) {
        return episodesAwaitableChain({
          data: null,
          error: opts.episodesError,
        });
      }
      return episodesAwaitableChain({
        data: opts.episodes,
        error: null,
      });
    }
    if (table === 'profiles') {
      return profileChain({
        data: opts.profile ?? { display_name: 'Jordan' },
        error: null,
      });
    }
    throw new Error(`unexpected table in mock: ${table}`);
  });
  return { from } as unknown as AbstrackSupabaseClient;
}

function symptomRow(
  partial: Pick<EpisodeSymptomRow, 'id' | 'episode_id' | 'created_at'>,
): EpisodeSymptomRow {
  return {
    ...partial,
    user_id: PATIENT_ID,
    preset_symptom_id: null,
    symptom_name: 'Nausea',
    response_type: 'yes_no',
    response_boolean: true,
    response_severity: null,
    response_text: null,
    sort_order: 0,
    updated_at: partial.created_at,
  };
}

function standaloneMarkerRow(
  partial: Pick<HealthMarkerRow, 'id' | 'recorded_at'>,
): HealthMarkerRow {
  const ts = partial.recorded_at;
  return {
    ...partial,
    user_id: PATIENT_ID,
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
    notes: null,
    created_at: ts,
    updated_at: ts,
  };
}

function episodeMarkerRow(
  partial: Pick<HealthMarkerRow, 'id' | 'episode_id' | 'recorded_at'> &
    Partial<Pick<HealthMarkerRow, 'notes' | 'value_numeric'>>,
): HealthMarkerRow {
  const ts = partial.recorded_at;
  return {
    ...partial,
    user_id: PATIENT_ID,
    preset_health_marker_id: null,
    marker_kind: 'heart_rate',
    custom_name: null,
    custom_name_key: null,
    custom_unit: null,
    custom_unit_key: null,
    value_numeric:
      partial.value_numeric !== undefined ? partial.value_numeric : 72,
    systolic_numeric: null,
    diastolic_numeric: null,
    notes: partial.notes !== undefined ? partial.notes : null,
    created_at: ts,
    updated_at: ts,
  };
}

describe('assertActivePractitionerGrantForPatient', () => {
  it('returns permission_denied when practitioner_access has no matching row', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({
      data: null,
      error: null,
    });
    const is = vi.fn().mockReturnValue({ maybeSingle });
    const eq = vi.fn().mockReturnValue({ is });
    const select = vi.fn().mockReturnValue({ eq });
    const from = vi.fn().mockReturnValue({ select });
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await assertActivePractitionerGrantForPatient(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('permission_denied');

    expect(from).toHaveBeenCalledWith('practitioner_access');
    expect(eq).toHaveBeenCalledWith('patient_user_id', PATIENT_ID);
    expect(is).toHaveBeenCalledWith('revoked_at', null);
  });
});

describe('loadPractitionerPatientObservationReadModel', () => {
  beforeEach(() => {
    listStandaloneHealthMarkersForUser.mockReset();
    listEpisodeHealthMarkersForEpisode.mockReset();
    listFoodDiaryEntriesForUser.mockReset();
    listFoodDiaryEntriesForEpisode.mockReset();
    listEpisodeSymptomsForEpisode.mockReset();
    listStandaloneHealthMarkersForUser.mockResolvedValue({
      ok: true,
      data: [],
    });
    listFoodDiaryEntriesForUser.mockResolvedValue({ ok: true, data: [] });
  });

  it('returns consolidated read model when grants, episodes, batch PHI, and profile succeed', async () => {
    const ep = episodeFixture('ep-one', PATIENT_ID);
    const symptoms = [
      symptomRow({
        id: 'sym-old',
        episode_id: ep.id,
        created_at: '2026-04-01T10:00:00.000Z',
      }),
      symptomRow({
        id: 'sym-new',
        episode_id: ep.id,
        created_at: '2026-04-01T12:00:00.000Z',
      }),
    ];
    const client = clientForReadModel({
      episodes: [ep],
      symptoms,
      profile: { display_name: 'Jordan Lee' },
    });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }

    expect(result.data.patientUserId).toBe(PATIENT_ID);
    expect(result.data.patientDisplayName).toBe('Jordan Lee');
    expect(result.data.moreEpisodesOmitted).toBe(false);
    expect(result.data.standaloneHealthMarkersTruncated).toBe(false);
    expect(result.data.standaloneFoodDiaryTruncated).toBe(false);
    expect(result.data.episodesWithTimelines).toHaveLength(1);
    const block = result.data.episodesWithTimelines[0];
    expect(block.episode.id).toBe(ep.id);
    expect(block.moreSymptomsOmitted).toBe(false);
    expect(block.moreHealthMarkersOmitted).toBe(false);
    expect(block.moreFoodDiaryOmitted).toBe(false);

    expect(block.timeline.map((t) => t.id)).toEqual(['sym-old', 'sym-new']);

    const windowLimit = EPISODE_TIMELINE_SOURCE_LIMIT + 1;
    expect(listEpisodeSymptomsForEpisode).toHaveBeenCalledWith(
      client,
      ep.id,
      expect.objectContaining({
        limit: windowLimit,
        orderBy: 'recent',
      }),
    );
    expect(listEpisodeHealthMarkersForEpisode).toHaveBeenCalledWith(
      client,
      ep.id,
      expect.objectContaining({ limit: windowLimit }),
    );
    expect(listFoodDiaryEntriesForEpisode).toHaveBeenCalledWith(
      client,
      ep.id,
      expect.objectContaining({ limit: windowLimit }),
    );

    expect(listStandaloneHealthMarkersForUser).toHaveBeenCalledWith(
      client,
      PATIENT_ID,
      expect.objectContaining({
        limit: PRACTITIONER_STANDALONE_OBSERVATION_CAP + 1,
        offset: 0,
      }),
    );
    expect(listFoodDiaryEntriesForUser).toHaveBeenCalledWith(
      client,
      PATIENT_ID,
      expect.objectContaining({
        limit: PRACTITIONER_STANDALONE_OBSERVATION_CAP + 1,
        offset: 0,
        standaloneOnly: true,
      }),
    );
  });

  it('loads episode observation streams in waves (bounded concurrent episodes)', async () => {
    const episodeCount = PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK * 4;
    const episodes = Array.from({ length: episodeCount }, (_, i) =>
      episodeFixture(`ep-wave-${String(i).padStart(3, '0')}`, PATIENT_ID),
    );

    let symptomInFlight = 0;
    let maxSymptomInFlight = 0;
    const client = clientForReadModel({
      episodes,
      listEpisodeSymptomsForEpisodeOverride: async () => {
        symptomInFlight += 1;
        maxSymptomInFlight = Math.max(maxSymptomInFlight, symptomInFlight);
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 25);
        });
        symptomInFlight -= 1;
        return { ok: true as const, data: [] };
      },
    });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    expect(maxSymptomInFlight).toBe(PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK);
    expect(listEpisodeSymptomsForEpisode).toHaveBeenCalledTimes(episodeCount);
  });

  it('merges numeric health-marker patient notes into episode timelines (detail / detailFull)', async () => {
    const ep = episodeFixture('ep-marker-notes', PATIENT_ID);
    const recordedAt = '2026-06-01T12:00:00.000Z';
    const marker = episodeMarkerRow({
      id: 'hm-with-notes',
      episode_id: ep.id,
      recorded_at: recordedAt,
      value_numeric: 88,
      notes: 'Resting before vitals',
    });
    const client = clientForReadModel({
      episodes: [ep],
      markers: [marker],
    });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const hmTimelineRow = result.data.episodesWithTimelines[0]?.timeline.find(
      (t) => t.kind === 'health_marker' && t.id === 'hm-with-notes',
    );
    expect(hmTimelineRow).toBeDefined();
    expect(hmTimelineRow).toMatchObject({
      ...episodeTimelineMeasurementDetailWithOptionalNotes(
        '88',
        'Resting before vitals',
      ),
    });
  });

  it('sets moreEpisodesOmitted when episode query returns over the history cap', async () => {
    const episodes = Array.from(
      { length: PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP + 1 },
      (_, i) => episodeFixture(`ep-${String(i).padStart(3, '0')}`, PATIENT_ID),
    );
    const client = clientForReadModel({ episodes });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.moreEpisodesOmitted).toBe(true);
    expect(result.data.episodesWithTimelines).toHaveLength(
      PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
    );
    expect(
      new Set(result.data.episodesWithTimelines.map((b) => b.episode.id)).size,
    ).toBe(PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP);
  });

  it('sets standalone truncation flags when list helpers return over the standalone cap', async () => {
    const markers = Array.from(
      { length: PRACTITIONER_STANDALONE_OBSERVATION_CAP + 1 },
      (_, i) =>
        standaloneMarkerRow({
          id: `hm-${i}`,
          recorded_at: new Date(Date.UTC(2026, 4, 1, 0, i, 0)).toISOString(),
        }),
    );
    listStandaloneHealthMarkersForUser.mockResolvedValue({
      ok: true,
      data: markers,
    });
    const foods: FoodDiaryEntryRow[] = Array.from(
      { length: PRACTITIONER_STANDALONE_OBSERVATION_CAP + 1 },
      (_, i) => {
        const loggedAt = new Date(Date.UTC(2026, 5, 1, 0, i, 0)).toISOString();
        return {
          id: `fd-${i}`,
          user_id: PATIENT_ID,
          episode_id: null,
          meal_tag: 'Snack' as const,
          food_note: `note ${i}`,
          logged_at: loggedAt,
          created_at: loggedAt,
          updated_at: loggedAt,
        };
      },
    );
    listFoodDiaryEntriesForUser.mockResolvedValue({
      ok: true,
      data: foods,
    });

    const ep = episodeFixture('ep-x', PATIENT_ID);
    const client = clientForReadModel({ episodes: [ep] });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    expect(result.data.standaloneHealthMarkersTruncated).toBe(true);
    expect(result.data.standaloneFoodDiaryTruncated).toBe(true);
    expect(result.data.standaloneTimeline.length).toBe(
      PRACTITIONER_STANDALONE_OBSERVATION_CAP * 2,
    );
    expect(
      result.data.standaloneTimeline.filter((r) => r.kind === 'health_marker'),
    ).toHaveLength(PRACTITIONER_STANDALONE_OBSERVATION_CAP);
    expect(
      result.data.standaloneTimeline.filter((r) => r.kind === 'food'),
    ).toHaveLength(PRACTITIONER_STANDALONE_OBSERVATION_CAP);
  });

  it('sets per-episode omission flags when batched rows exceed the timeline source limit', async () => {
    const ep = episodeFixture('ep-heavy', PATIENT_ID);
    const symptoms = Array.from(
      { length: EPISODE_TIMELINE_SOURCE_LIMIT + 1 },
      (_, i) =>
        symptomRow({
          id: `sym-${i}`,
          episode_id: ep.id,
          created_at: new Date(Date.UTC(2026, 3, 1, 0, 0, i)).toISOString(),
        }),
    );
    const client = clientForReadModel({ episodes: [ep], symptoms });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    if (!result.ok) {
      return;
    }
    const block = result.data.episodesWithTimelines[0];
    expect(block?.moreSymptomsOmitted).toBe(true);
    expect(block?.timeline.filter((t) => t.kind === 'symptom')).toHaveLength(
      EPISODE_TIMELINE_SOURCE_LIMIT,
    );
  });

  it('returns permission_denied when grant option is explicitly null', async () => {
    const client = clientForReadModel({
      grant: null,
      episodes: [episodeFixture('ep-no-grant', PATIENT_ID)],
    });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.code).toBe('permission_denied');
  });

  it('propagates episodes select errors', async () => {
    const client = clientForReadModel({
      episodes: [],
      episodesError: { message: 'table unavailable', code: 'XX000' },
    });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(false);
  });

  it('propagates episode symptom list failures', async () => {
    const ep = episodeFixture('ep-e', PATIENT_ID);
    const client = clientForReadModel({
      episodes: [ep],
      symptomsError: { message: 'timeout', code: '57014' },
    });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(false);
  });

  it('propagates standalone health-marker list failures', async () => {
    listStandaloneHealthMarkersForUser.mockResolvedValue({
      ok: false,
      error: new PresetDataError('unknown', 'Standalone markers failed.'),
    });
    const ep = episodeFixture('ep-y', PATIENT_ID);
    const client = clientForReadModel({ episodes: [ep] });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(false);
    if (result.ok) {
      return;
    }
    expect(result.error.message).toContain('Standalone markers failed');
  });

  it('calls per-episode observation list helpers once per episode in the loaded window', async () => {
    const episodes = Array.from(
      { length: PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP },
      (_, i) => episodeFixture(`ep-${String(i).padStart(3, '0')}`, PATIENT_ID),
    );
    const client = clientForReadModel({ episodes });

    const result = await loadPractitionerPatientObservationReadModel(
      client,
      PATIENT_ID,
    );

    expect(result.ok).toBe(true);
    expect(listEpisodeSymptomsForEpisode).toHaveBeenCalledTimes(
      PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
    );
    expect(listEpisodeHealthMarkersForEpisode).toHaveBeenCalledTimes(
      PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
    );
    expect(listFoodDiaryEntriesForEpisode).toHaveBeenCalledTimes(
      PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP,
    );
  });
});
