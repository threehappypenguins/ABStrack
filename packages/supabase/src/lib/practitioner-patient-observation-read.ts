import type { Uuid } from '@abstrack/types';
import type { Database } from './database.types.js';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import {
  EPISODE_TIMELINE_SOURCE_LIMIT,
  mergeEpisodeObservationRowsToTimeline,
  mergeStandaloneHealthAndFoodRowsToTimeline,
  type EpisodeTimelineItem,
} from './episode-observation-timeline.js';
import {
  listEpisodeHealthMarkersForEpisode,
  listStandaloneHealthMarkersForUser,
} from './episode-health-marker-data.js';
import { listEpisodeSymptomsForEpisode } from './episode-symptom-data.js';
import {
  listFoodDiaryEntriesForEpisode,
  listFoodDiaryEntriesForUser,
} from './food-diary-data.js';
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

/**
 * Fetch `limit + 1` newest rows per stream so omission flags match {@link EPISODE_TIMELINE_SOURCE_LIMIT}.
 */
function practitionerEpisodeObservationWindowLimit(): number {
  return EPISODE_TIMELINE_SOURCE_LIMIT + 1;
}

type EpisodeTimelineBatchEntry = {
  timeline: EpisodeTimelineItem[];
  moreSymptomsOmitted: boolean;
  moreHealthMarkersOmitted: boolean;
  moreFoodDiaryOmitted: boolean;
};

/**
 * Loads bounded episode-bound observations for one episode using existing list helpers (each query
 * applies `LIMIT` on the server). Three parallel requests per episode; see {@link loadEpisodeTimelinesBatched}.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 */
async function loadEpisodeTimelineForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<EpisodeTimelineBatchEntry>> {
  const windowLimit = practitionerEpisodeObservationWindowLimit();
  const [syR, hmR, fdR] = await Promise.all([
    listEpisodeSymptomsForEpisode(client, episodeId, {
      limit: windowLimit,
      orderBy: 'recent',
    }),
    listEpisodeHealthMarkersForEpisode(client, episodeId, {
      limit: windowLimit,
    }),
    listFoodDiaryEntriesForEpisode(client, episodeId, {
      limit: windowLimit,
    }),
  ]);

  if (!syR.ok) {
    return syR;
  }
  if (!hmR.ok) {
    return hmR;
  }
  if (!fdR.ok) {
    return fdR;
  }

  const rawSy = syR.data;
  const rawHm = hmR.data;
  const rawFd = fdR.data;
  const moreSymptomsOmitted = rawSy.length > EPISODE_TIMELINE_SOURCE_LIMIT;
  const moreHealthMarkersOmitted = rawHm.length > EPISODE_TIMELINE_SOURCE_LIMIT;
  const moreFoodDiaryOmitted = rawFd.length > EPISODE_TIMELINE_SOURCE_LIMIT;

  return {
    ok: true,
    data: {
      timeline: mergeEpisodeObservationRowsToTimeline(
        rawSy.slice(0, EPISODE_TIMELINE_SOURCE_LIMIT),
        rawHm.slice(0, EPISODE_TIMELINE_SOURCE_LIMIT),
        rawFd.slice(0, EPISODE_TIMELINE_SOURCE_LIMIT),
      ),
      moreSymptomsOmitted,
      moreHealthMarkersOmitted,
      moreFoodDiaryOmitted,
    },
  };
}

/**
 * Loads all requested episode timelines in parallel ({@link loadEpisodeTimelineForEpisode} per id).
 * See **AGENTS.md** (“Practitioner episode timelines”) for the intentional tradeoff vs batched `.in` without limits.
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeIds - Episode primary keys (length ≤ {@link PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP}).
 */
async function loadEpisodeTimelinesBatched(
  client: AbstrackSupabaseClient,
  episodeIds: Uuid[],
): Promise<PresetDataResult<Map<string, EpisodeTimelineBatchEntry>>> {
  if (episodeIds.length === 0) {
    return { ok: true, data: new Map() };
  }

  try {
    const entries = await Promise.all(
      episodeIds.map((eid) => loadEpisodeTimelineForEpisode(client, eid)),
    );
    const out = new Map<string, EpisodeTimelineBatchEntry>();
    for (let i = 0; i < episodeIds.length; i++) {
      const row = entries[i];
      if (!row.ok) {
        return row;
      }
      out.set(episodeIds[i], row.data);
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
 * Episode-bound timelines load {@link EPISODE_TIMELINE_SOURCE_LIMIT} + 1 rows per stream **per episode**
 * via list helpers (PostgREST `LIMIT`, no extra migrations). {@link PractitionerPatientEpisodeObservationBlock}
 * reports when a stream still has older rows beyond that cap.
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
      loadEpisodeTimelinesBatched(client, episodeIds),
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
