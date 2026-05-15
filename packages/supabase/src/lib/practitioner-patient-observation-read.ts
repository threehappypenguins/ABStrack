import type {
  EpisodeSymptomRow,
  FoodDiaryEntryRow,
  HealthMarkerRow,
  Uuid,
} from '@abstrack/types';
import type { Database } from './database.types.js';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import {
  EPISODE_TIMELINE_SOURCE_LIMIT,
  mergeEpisodeObservationRowsToTimeline,
  mergeStandaloneHealthAndFoodRowsToTimeline,
  type EpisodeTimelineItem,
} from './episode-observation-timeline.js';
import { listStandaloneHealthMarkersForUser } from './episode-health-marker-data.js';
import { listFoodDiaryEntriesForUser } from './food-diary-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Maximum episodes loaded for practitioner history (most recent first). Additional rows are omitted
 * and {@link PractitionerPatientObservationReadModel.moreEpisodesOmitted} indicates truncation.
 */
export const PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP = 100;

/**
 * Maximum standalone health-marker and food-diary rows loaded per stream (newest first). When more
 * rows exist, {@link PractitionerPatientObservationReadModel.standaloneHealthMarkersTruncated} /
 * {@link PractitionerPatientObservationReadModel.standaloneFoodDiaryTruncated} is set.
 */
export const PRACTITIONER_STANDALONE_OBSERVATION_CAP = 200;

/** One patient's episode rows as visible to practitioner read paths (Supabase-generated shape). */
export type PractitionerPatientEpisodeRow =
  Database['public']['Tables']['episodes']['Row'];

/** One episode card: merged timeline plus per-stream omission flags (see {@link EPISODE_TIMELINE_SOURCE_LIMIT}). */
export type PractitionerPatientEpisodeObservationBlock = {
  episode: PractitionerPatientEpisodeRow;
  timeline: EpisodeTimelineItem[];
  /** True when more symptom rows exist for this episode than included after capping. */
  moreSymptomsOmitted: boolean;
  /** True when more episode-bound health-marker rows exist than included after capping. */
  moreHealthMarkersOmitted: boolean;
  /** True when more episode-tied food diary rows exist than included after capping. */
  moreFoodDiaryOmitted: boolean;
};

/** Read-only PHI bundle for practitioner patient §8 timelines (episode-bound + standalone). */
export type PractitionerPatientObservationReadModel = {
  patientUserId: Uuid;
  patientDisplayName: string | null;
  /** Most recent episodes first; each carries a chronologically ascending merged timeline within the episode. */
  episodesWithTimelines: PractitionerPatientEpisodeObservationBlock[];
  /** Stand-alone health markers and food diary (no episode), oldest → newest within this list. */
  standaloneTimeline: EpisodeTimelineItem[];
  /** When true, older episodes beyond {@link PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP} are omitted. */
  moreEpisodesOmitted: boolean;
  /**
   * When true, more standalone health-marker rows exist than {@link PRACTITIONER_STANDALONE_OBSERVATION_CAP}
   * (newest-first window); older markers are omitted from {@link PractitionerPatientObservationReadModel.standaloneTimeline}.
   */
  standaloneHealthMarkersTruncated: boolean;
  /**
   * When true, more standalone food diary rows exist than {@link PRACTITIONER_STANDALONE_OBSERVATION_CAP};
   * older entries are omitted from {@link PractitionerPatientObservationReadModel.standaloneTimeline}.
   */
  standaloneFoodDiaryTruncated: boolean;
};

type PractitionerAccessGrantIdRow = Pick<
  Database['public']['Tables']['practitioner_access']['Row'],
  'id'
>;

/** Descending ISO timestamp comparison (newest first); fallback string compare if unparsable. */
function compareIsoDesc(aIso: string, bIso: string): number {
  const aMs = Date.parse(aIso);
  const bMs = Date.parse(bIso);
  const aOk = Number.isFinite(aMs);
  const bOk = Number.isFinite(bMs);
  if (aOk && bOk && aMs !== bMs) {
    return bMs - aMs;
  }
  return bIso.localeCompare(aIso);
}

function compareEpisodeSymptomRowsRecentFirst(
  a: EpisodeSymptomRow,
  b: EpisodeSymptomRow,
): number {
  const byTime = compareIsoDesc(a.created_at, b.created_at);
  if (byTime !== 0) {
    return byTime;
  }
  return b.id.localeCompare(a.id);
}

function compareHealthMarkerRowsRecentFirst(
  a: HealthMarkerRow,
  b: HealthMarkerRow,
): number {
  let c = compareIsoDesc(a.recorded_at, b.recorded_at);
  if (c !== 0) {
    return c;
  }
  c = compareIsoDesc(a.created_at, b.created_at);
  if (c !== 0) {
    return c;
  }
  return b.id.localeCompare(a.id);
}

function compareFoodDiaryRowsRecentFirst(
  a: FoodDiaryEntryRow,
  b: FoodDiaryEntryRow,
): number {
  let c = compareIsoDesc(a.logged_at, b.logged_at);
  if (c !== 0) {
    return c;
  }
  c = compareIsoDesc(a.created_at, b.created_at);
  if (c !== 0) {
    return c;
  }
  return b.id.localeCompare(a.id);
}

function bucketRowsByEpisodeId<T extends { episode_id: string | null }>(
  rows: T[],
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const eid = row.episode_id;
    if (eid == null) {
      continue;
    }
    const list = map.get(eid);
    if (list) {
      list.push(row);
    } else {
      map.set(eid, [row]);
    }
  }
  return map;
}

function cappedRecentEpisodeSymptoms(
  rows: EpisodeSymptomRow[],
): EpisodeSymptomRow[] {
  return [...rows]
    .sort(compareEpisodeSymptomRowsRecentFirst)
    .slice(0, EPISODE_TIMELINE_SOURCE_LIMIT);
}

function cappedRecentEpisodeHealthMarkers(
  rows: HealthMarkerRow[],
): HealthMarkerRow[] {
  return [...rows]
    .sort(compareHealthMarkerRowsRecentFirst)
    .slice(0, EPISODE_TIMELINE_SOURCE_LIMIT);
}

function cappedRecentEpisodeFood(
  rows: FoodDiaryEntryRow[],
): FoodDiaryEntryRow[] {
  return [...rows]
    .sort(compareFoodDiaryRowsRecentFirst)
    .slice(0, EPISODE_TIMELINE_SOURCE_LIMIT);
}

type EpisodeTimelineBatchEntry = {
  timeline: EpisodeTimelineItem[];
  moreSymptomsOmitted: boolean;
  moreHealthMarkersOmitted: boolean;
  moreFoodDiaryOmitted: boolean;
};

/**
 * Loads all episode-bound symptoms, markers, and food for `episodeIds` in **three** round-trips,
 * then caps and merges per episode to match {@link mergeEpisodeObservationRowsToTimeline} / the
 * single-episode list helpers (newest-first cap per source, then merged oldest-first timeline).
 *
 * @param client - Supabase client (RLS applies).
 * @param patientUserId - Episode owner (`episodes.user_id`); narrows reads and matches RLS intent.
 * @param episodeIds - Episode primary keys to include (typically the loaded history cap set).
 */
async function loadEpisodeTimelinesBatched(
  client: AbstrackSupabaseClient,
  patientUserId: Uuid,
  episodeIds: Uuid[],
): Promise<PresetDataResult<Map<string, EpisodeTimelineBatchEntry>>> {
  if (episodeIds.length === 0) {
    return { ok: true, data: new Map() };
  }

  try {
    const [syR, hmR, fdR] = await Promise.all([
      client
        .from('episode_symptoms')
        .select('*')
        .eq('user_id', patientUserId)
        .in('episode_id', episodeIds),
      client
        .from('health_markers')
        .select('*')
        .eq('user_id', patientUserId)
        .in('episode_id', episodeIds),
      client
        .from('food_diary_entries')
        .select('*')
        .eq('user_id', patientUserId)
        .in('episode_id', episodeIds),
    ]);

    if (syR.error) {
      return { ok: false, error: toPresetDataError(syR.error) };
    }
    if (hmR.error) {
      return { ok: false, error: toPresetDataError(hmR.error) };
    }
    if (fdR.error) {
      return { ok: false, error: toPresetDataError(fdR.error) };
    }

    const symptomsByEp = bucketRowsByEpisodeId(
      (syR.data ?? []) as EpisodeSymptomRow[],
    );
    const markersByEp = bucketRowsByEpisodeId(
      (hmR.data ?? []) as HealthMarkerRow[],
    );
    const foodByEp = bucketRowsByEpisodeId(
      (fdR.data ?? []) as FoodDiaryEntryRow[],
    );

    const out = new Map<string, EpisodeTimelineBatchEntry>();
    for (const eid of episodeIds) {
      const rawSy = symptomsByEp.get(eid) ?? [];
      const rawHm = markersByEp.get(eid) ?? [];
      const rawFd = foodByEp.get(eid) ?? [];
      const moreSymptomsOmitted = rawSy.length > EPISODE_TIMELINE_SOURCE_LIMIT;
      const moreHealthMarkersOmitted =
        rawHm.length > EPISODE_TIMELINE_SOURCE_LIMIT;
      const moreFoodDiaryOmitted = rawFd.length > EPISODE_TIMELINE_SOURCE_LIMIT;
      const sy = cappedRecentEpisodeSymptoms(rawSy);
      const hm = cappedRecentEpisodeHealthMarkers(rawHm);
      const fd = cappedRecentEpisodeFood(rawFd);
      out.set(eid, {
        timeline: mergeEpisodeObservationRowsToTimeline(sy, hm, fd),
        moreSymptomsOmitted,
        moreHealthMarkersOmitted,
        moreFoodDiaryOmitted,
      });
    }

    return { ok: true, data: out };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

async function loadEpisodesRecentFirst(
  client: AbstrackSupabaseClient,
  patientUserId: Uuid,
): Promise<
  PresetDataResult<{
    episodes: PractitionerPatientEpisodeRow[];
    moreOmitted: boolean;
  }>
> {
  try {
    const { data, error } = await client
      .from('episodes')
      .select('*')
      .eq('user_id', patientUserId)
      .order('started_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP + 1);

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    const rows = (data ?? []) as PractitionerPatientEpisodeRow[];
    const moreOmitted = rows.length > PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP;
    return {
      ok: true,
      data: {
        episodes: moreOmitted
          ? rows.slice(0, PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP)
          : rows,
        moreOmitted,
      },
    };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

async function loadPatientDisplayName(
  client: AbstrackSupabaseClient,
  patientUserId: Uuid,
): Promise<PresetDataResult<string | null>> {
  try {
    const { data, error } = await client
      .from('profiles')
      .select('display_name')
      .eq('id', patientUserId)
      .maybeSingle();

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }
    const name =
      typeof data?.display_name === 'string' ? data.display_name : null;
    return { ok: true, data: name };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Verifies there is an **active** `practitioner_access` row for `patient_user_id` under RLS before
 * running broader PHI selects (fail-fast when the practitioner has no grant or route was forged).
 *
 * Uses **SELECT-only** queries end-to-end; practitioners never INSERT/UPDATE PHI tables via this helper.
 *
 * @param client - Browser Supabase client (practitioner session; RLS applies).
 * @param patientUserId - `auth.users.id` of the patient.
 */
export async function assertActivePractitionerGrantForPatient(
  client: AbstrackSupabaseClient,
  patientUserId: Uuid,
): Promise<PresetDataResult<void>> {
  try {
    const { data, error } = await client
      .from('practitioner_access')
      .select('id')
      .eq('patient_user_id', patientUserId)
      .is('revoked_at', null)
      .maybeSingle();

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    const row = data as PractitionerAccessGrantIdRow | null;
    if (row == null) {
      return {
        ok: false,
        error: new PresetDataError(
          'permission_denied',
          'You do not have access to this patient, or the link is no longer active.',
        ),
      };
    }

    return { ok: true, data: undefined };
  } catch (caught) {
    return { ok: false, error: toPresetDataError(caught) };
  }
}

/**
 * Loads **read-only** episode histories (merged symptom + marker + episode-tied food timelines) plus
 * standalone health markers / food diary for one patient. Intended for practitioner §8 review surfaces.
 *
 * Ordering matches the episode observation timeline helper: **oldest first** within merged lists,
 * with `id` as a stable tie-breaker when timestamps match.
 *
 * Episode-bound timelines apply {@link EPISODE_TIMELINE_SOURCE_LIMIT} per stream (symptoms, markers,
 * food); {@link PractitionerPatientEpisodeObservationBlock} exposes when each stream was capped using
 * batched row counts.
 *
 * @param client - Browser Supabase client (practitioner session; RLS applies).
 * @param patientUserId - Patient auth user id (same UUID as `/patients/[patientId]`).
 */
export async function loadPractitionerPatientObservationReadModel(
  client: AbstrackSupabaseClient,
  patientUserId: Uuid,
): Promise<PresetDataResult<PractitionerPatientObservationReadModel>> {
  const gate = await assertActivePractitionerGrantForPatient(
    client,
    patientUserId,
  );
  if (!gate.ok) {
    return gate;
  }

  const episodesResult = await loadEpisodesRecentFirst(client, patientUserId);
  if (!episodesResult.ok) {
    return episodesResult;
  }

  const episodes = episodesResult.data.episodes;
  const episodeIds = episodes.map((e) => e.id);

  const [profileRes, standaloneHm, standaloneFood, timelinesBatch] =
    await Promise.all([
      loadPatientDisplayName(client, patientUserId),
      listStandaloneHealthMarkersForUser(client, patientUserId, {
        limit: PRACTITIONER_STANDALONE_OBSERVATION_CAP + 1,
        offset: 0,
      }),
      listFoodDiaryEntriesForUser(client, patientUserId, {
        limit: PRACTITIONER_STANDALONE_OBSERVATION_CAP + 1,
        offset: 0,
        standaloneOnly: true,
      }),
      loadEpisodeTimelinesBatched(client, patientUserId, episodeIds),
    ]);

  if (!profileRes.ok) {
    return profileRes;
  }
  if (!standaloneHm.ok) {
    return standaloneHm;
  }
  if (!standaloneFood.ok) {
    return standaloneFood;
  }
  if (!timelinesBatch.ok) {
    return timelinesBatch;
  }

  const hmRows = standaloneHm.data;
  const standaloneHealthMarkersTruncated =
    hmRows.length > PRACTITIONER_STANDALONE_OBSERVATION_CAP;
  const hmCapped = hmRows.slice(0, PRACTITIONER_STANDALONE_OBSERVATION_CAP);

  const fdRows = standaloneFood.data;
  const standaloneFoodDiaryTruncated =
    fdRows.length > PRACTITIONER_STANDALONE_OBSERVATION_CAP;
  const fdCapped = fdRows.slice(0, PRACTITIONER_STANDALONE_OBSERVATION_CAP);

  const standaloneTimeline = mergeStandaloneHealthAndFoodRowsToTimeline(
    hmCapped,
    fdCapped,
  );

  const timelineByEpisodeId = timelinesBatch.data;
  const episodesWithTimelines: PractitionerPatientEpisodeObservationBlock[] =
    episodes.map((episode) => {
      const block = timelineByEpisodeId.get(episode.id);
      return {
        episode,
        timeline: block?.timeline ?? [],
        moreSymptomsOmitted: block?.moreSymptomsOmitted ?? false,
        moreHealthMarkersOmitted: block?.moreHealthMarkersOmitted ?? false,
        moreFoodDiaryOmitted: block?.moreFoodDiaryOmitted ?? false,
      };
    });

  return {
    ok: true,
    data: {
      patientUserId,
      patientDisplayName: profileRes.data,
      episodesWithTimelines,
      standaloneTimeline,
      moreEpisodesOmitted: episodesResult.data.moreOmitted,
      standaloneHealthMarkersTruncated,
      standaloneFoodDiaryTruncated,
    },
  };
}
