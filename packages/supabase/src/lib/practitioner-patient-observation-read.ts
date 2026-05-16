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

/**
 * How many episode timelines load at once inside {@link loadEpisodeTimelinesBatched}. Each episode
 * still fans out to **three** list helpers (symptoms, markers, episode food), so a single wave is at
 * most `this × 3` concurrent PostgREST requests — bounded to protect browser connection pools and
 * avoid rate-limit spikes on patients with long histories (see {@link PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP}).
 */
export const PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK = 5;

/**
 * PostgREST `select` string for practitioner patient §8 episode history. Matches fields rendered on
 * the patient detail page only (`id`, type, label, start/end); omits free-text PHI such as `note`
 * and `additional_notes` from the browser payload.
 */
export const PRACTITIONER_PATIENT_EPISODE_LIST_SELECT =
  'id, episode_type, episode_label, started_at, ended_at' as const;

/** Episode row fields exposed to practitioner observation read paths (narrowed from full `episodes`). */
export type PractitionerPatientEpisodeRow = Pick<
  Database['public']['Tables']['episodes']['Row'],
  'id' | 'episode_type' | 'episode_label' | 'started_at' | 'ended_at'
>;

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
 * applies `LIMIT` on the server). Three parallel requests per episode; waves of episodes are capped
 * by {@link PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK} in {@link loadEpisodeTimelinesBatched}.
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
 * Loads all requested episode timelines in waves of {@link PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK}
 * episodes ({@link loadEpisodeTimelineForEpisode} per id, `Promise.all` inside each wave only).
 * Preserves per-episode caps and result order while bounding worst-case concurrent PostgREST traffic.
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

  const out = new Map<string, EpisodeTimelineBatchEntry>();
  const chunk = PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK;

  try {
    for (let offset = 0; offset < episodeIds.length; offset += chunk) {
      const slice = episodeIds.slice(offset, offset + chunk);
      const entries = await Promise.all(
        slice.map((eid) => loadEpisodeTimelineForEpisode(client, eid)),
      );
      for (let j = 0; j < slice.length; j++) {
        const row = entries[j];
        if (!row.ok) {
          return row;
        }
        out.set(slice[j], row.data);
      }
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
      .select(PRACTITIONER_PATIENT_EPISODE_LIST_SELECT)
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
 * User-facing copy when the observation read gate rejects the patient because the signed-in practitioner
 * has no active grant (or `user_has_practitioner_access` returned false). Distinct from RLS/MFA session
 * failures that map to generic `permission_denied` messages elsewhere.
 */
export const PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE =
  'You do not have access to this patient, or the link is no longer active.' as const;

/**
 * Verifies the **signed-in user** is allowed to act as a **practitioner** for this patient before
 * running broader PHI selects (fail-fast when there is no grant, the route was forged, or MFA rules
 * block access).
 *
 * Delegates to Postgres `public.user_has_practitioner_access`, which requires an active
 * `practitioner_access` row with `practitioner_user_id = auth.uid()`, matching `patient_user_id`, a
 * practitioner profile role, and the project’s MFA/AAL2 rules for password-sign-in practitioners.
 * This is **not** the same as selecting any `practitioner_access` row visible under RLS (patients may
 * read their own grant rows).
 *
 * Uses read-only RPC plus downstream SELECT helpers; practitioners never INSERT/UPDATE PHI tables
 * via this path.
 *
 * @param client - Browser Supabase client (practitioner session; RLS applies).
 * @param patientUserId - `auth.users.id` of the patient.
 */
export async function assertActivePractitionerGrantForPatient(
  client: AbstrackSupabaseClient,
  patientUserId: Uuid,
): Promise<PresetDataResult<void>> {
  try {
    const { data, error } = await client.rpc('user_has_practitioner_access', {
      p_patient_user_id: patientUserId,
    });

    if (error) {
      return { ok: false, error: toPresetDataError(error) };
    }

    if (data !== true) {
      return {
        ok: false,
        error: new PresetDataError(
          'permission_denied',
          PRACTITIONER_PATIENT_OBSERVATION_GRANT_DENIED_MESSAGE,
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
 * standalone health markers / food diary for one patient. Intended for practitioner patient-detail
 * review surfaces.
 *
 * Ordering matches the episode observation timeline helper: **oldest first** within merged lists,
 * with `id` as a stable tie-breaker when timestamps match. Episode-bound health-marker and
 * episode-tied food streams use {@link listEpisodeHealthMarkersForEpisode} and
 * {@link listFoodDiaryEntriesForEpisode} ordering aligned with that tie-break (`recorded_at` /
 * `logged_at`, then `id`) so capped windows match the merged list; standalone markers and food use
 * the same rules via {@link listStandaloneHealthMarkersForUser} and {@link listFoodDiaryEntriesForUser}.
 *
 * Episode-bound timelines load {@link EPISODE_TIMELINE_SOURCE_LIMIT} + 1 rows per stream **per episode**
 * via list helpers (PostgREST `LIMIT`, no extra migrations), in waves of
 * {@link PRACTITIONER_EPISODE_TIMELINE_LOAD_CHUNK} episodes so concurrent requests stay bounded.
 * {@link PractitionerPatientEpisodeObservationBlock} reports when a stream still has older rows beyond that cap.
 *
 * Episode list metadata uses {@link PRACTITIONER_PATIENT_EPISODE_LIST_SELECT} only (detail UI fields),
 * not `select('*')`, so free-text episode columns such as `note` / `additional_notes` are not returned
 * in this read path.
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
