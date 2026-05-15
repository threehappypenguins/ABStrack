import type { Uuid } from '@abstrack/types';
import type { Database } from './database.types.js';
import { PresetDataError, toPresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import {
  listEpisodeObservationTimeline,
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
/** Matches {@link EPISODE_TIMELINE_SOURCE_LIMIT} in episode-observation-timeline.ts (per source query). */
const STANDALONE_OBSERVATION_CAP = 200;
const EPISODE_TIMELINE_PARALLELISM = 6;

/** One patient's episode rows as visible to practitioner read paths (Supabase-generated shape). */
export type PractitionerPatientEpisodeRow =
  Database['public']['Tables']['episodes']['Row'];

/** Read-only PHI bundle for practitioner patient §8 timelines (episode-bound + standalone). */
export type PractitionerPatientObservationReadModel = {
  patientUserId: Uuid;
  patientDisplayName: string | null;
  /** Most recent episodes first; each carries a chronologically ascending merged timeline within the episode. */
  episodesWithTimelines: Array<{
    episode: PractitionerPatientEpisodeRow;
    timeline: EpisodeTimelineItem[];
  }>;
  /** Stand-alone health markers and food diary (no episode), oldest → newest within this list. */
  standaloneTimeline: EpisodeTimelineItem[];
  /** When true, older episodes beyond {@link PRACTITIONER_PATIENT_EPISODE_HISTORY_CAP} are omitted. */
  moreEpisodesOmitted: boolean;
};

type PractitionerAccessGrantIdRow = Pick<
  Database['public']['Tables']['practitioner_access']['Row'],
  'id'
>;

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

  const [profileRes, standaloneHm, standaloneFood] = await Promise.all([
    loadPatientDisplayName(client, patientUserId),
    listStandaloneHealthMarkersForUser(client, patientUserId, {
      limit: STANDALONE_OBSERVATION_CAP,
      offset: 0,
    }),
    listFoodDiaryEntriesForUser(client, patientUserId, {
      limit: STANDALONE_OBSERVATION_CAP,
      offset: 0,
      standaloneOnly: true,
    }),
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

  const standaloneTimeline = mergeStandaloneHealthAndFoodRowsToTimeline(
    standaloneHm.data,
    standaloneFood.data,
  );

  const episodes = episodesResult.data.episodes;
  const timelines: EpisodeTimelineItem[][] = [];

  for (let i = 0; i < episodes.length; i += EPISODE_TIMELINE_PARALLELISM) {
    const chunk = episodes.slice(i, i + EPISODE_TIMELINE_PARALLELISM);
    const chunkResults = await Promise.all(
      chunk.map((ep) => listEpisodeObservationTimeline(client, ep.id)),
    );
    for (const r of chunkResults) {
      if (!r.ok) {
        return r;
      }
      timelines.push(r.data);
    }
  }

  const episodesWithTimelines = episodes.map((episode, index) => ({
    episode,
    timeline: timelines[index] ?? [],
  }));

  return {
    ok: true,
    data: {
      patientUserId,
      patientDisplayName: profileRes.data,
      episodesWithTimelines,
      standaloneTimeline,
      moreEpisodesOmitted: episodesResult.data.moreOmitted,
    },
  };
}
