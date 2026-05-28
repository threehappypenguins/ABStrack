/**
 * Routes episode-flow mutations to PowerSync SQLite when the replica is available (offline-first),
 * otherwise uses Supabase REST (same RLS) when PowerSync is not configured on this install.
 *
 * Destructive ops (cancel / end / delete) write local SQLite first, then mirror to Supabase when
 * the device is online so list reloads against Postgres are not stale before PowerSync upload.
 */
import type {
  EpisodeRow,
  EpisodeSymptomRow,
  FoodDiaryEntryInsert,
  FoodDiaryEntryRow,
  FoodDiaryEntryUpdate,
  HealthMarkerRow,
  PresetHealthMarkerRow,
  PresetSymptomRow,
  SymptomPromptAnswer,
  Uuid,
} from '@abstrack/types';
import type {
  AbstrackSupabaseClient,
  CancelActiveEpisodeByIdResult,
  DeleteEpisodeByIdResult,
  EpisodePostMarkerStepWrite,
} from '@abstrack/supabase';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  PresetDataError,
  cancelActiveEpisodeById,
  completeEpisodePostMarkerStep,
  createFoodDiaryEntry,
  deleteCurrentPassEpisodeSymptomAnswer,
  deleteEpisodeById,
  deleteFoodDiaryEntry,
  endEpisodeIfStillActive,
  insertEpisodeHealthMarkerForLine,
  insertEpisodeSymptomAnswer,
  listEpisodeHealthMarkersForEpisode,
  listFoodDiaryEntriesForEpisode,
  normalizeFoodDiaryEntryUpdate,
  toPresetDataError,
  updateFoodDiaryEntry,
  validateAndNormalizeFoodDiaryCreateCore,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';
import {
  cancelActiveEpisodeByIdPowerSyncDb,
  completeEpisodePostMarkerStepPowerSyncDb,
  deleteCurrentPassEpisodeSymptomAnswerPowerSyncDb,
  deleteEpisodeByIdPowerSyncDb,
  deleteFoodDiaryEntryPowerSyncDb,
  endEpisodeIfStillActivePowerSyncDb,
  insertEpisodeHealthMarkerLineIntoPowerSyncDb,
  insertEpisodeSymptomAnswerIntoPowerSyncDb,
  insertFoodDiaryEntryPowerSyncDb,
  listFoodDiaryEntriesForEpisodePowerSyncDb,
  updateFoodDiaryEntryPowerSyncDb,
} from '../powersync/episode-flow-powersync-writes';
import { listEpisodeHealthMarkersForEpisodeFromPowerSyncDb } from '../powersync/powersync-episode-flow-reads';

/**
 * Result of {@link listEpisodeHealthMarkersForEpisodeOfflineFirst}, including whether rows were
 * served from local SQLite (so callers can avoid redundant remote-only reads when offline).
 */
export type ListEpisodeHealthMarkersOfflineFirstResult =
  | {
      ok: true;
      data: HealthMarkerRow[];
      /** `true` when `data` was read from PowerSync SQLite, not the Supabase fallback. */
      markersReadFromLocalReplica: boolean;
    }
  | { ok: false; error: PresetDataError };

function powerSyncWritesEnabled(
  db: PowerSyncDatabase | null | undefined,
): db is PowerSyncDatabase {
  return db != null;
}

/**
 * Cancel / end / delete: local SQLite first (offline queue), then Supabase REST when online so
 * reloads that read Postgres are not stale before PowerSync upload completes.
 */
async function episodeDestructiveMutationOfflineFirst<
  T extends { [k: string]: boolean },
>(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  outcomeKey: keyof T & string,
  cloudFn: (c: AbstrackSupabaseClient) => Promise<PresetDataResult<T>>,
  localFn: (db: PowerSyncDatabase) => Promise<PresetDataResult<T>>,
): Promise<PresetDataResult<T>> {
  if (!powerSyncWritesEnabled(powerSyncDb)) {
    return cloudFn(client);
  }
  const local = await localFn(powerSyncDb);
  const deviceOnline = await fetchMobileDeviceIsConnected();
  if (deviceOnline === false) {
    return local;
  }
  const cloud = await cloudFn(client);
  if (!local.ok) {
    return cloud.ok ? cloud : local;
  }
  if (!cloud.ok) {
    return local;
  }
  return {
    ok: true,
    data: {
      ...local.data,
      [outcomeKey]: Boolean(local.data[outcomeKey] || cloud.data[outcomeKey]),
    } as T,
  };
}

/**
 * Inserts a symptom answer using PowerSync when `powerSyncDb` is set; otherwise Supabase.
 *
 * @param client - Mobile Supabase client.
 * @param powerSyncDb - Open PowerSync DB when replication is enabled for this session.
 */
export async function insertEpisodeSymptomAnswerOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  },
): Promise<PresetDataResult<EpisodeSymptomRow>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return insertEpisodeSymptomAnswerIntoPowerSyncDb(powerSyncDb, args);
  }
  return insertEpisodeSymptomAnswer(client, args);
}

/**
 * Inserts an episode health marker line offline-first.
 *
 * @param client - Mobile Supabase client.
 * @param powerSyncDb - Open PowerSync DB when replication is enabled.
 */
export async function insertEpisodeHealthMarkerLineOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    line: PresetHealthMarkerRow;
    valueNumeric?: number | null;
    systolicNumeric?: number | null;
    diastolicNumeric?: number | null;
    notes?: string | null;
    recordedAt?: string;
  },
): Promise<PresetDataResult<HealthMarkerRow>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return insertEpisodeHealthMarkerLineIntoPowerSyncDb(powerSyncDb, args);
  }
  return insertEpisodeHealthMarkerForLine(client, args);
}

/**
 * Lists episode health markers from the PowerSync replica when `powerSyncDb` is open, otherwise via Supabase REST.
 *
 * When the replica is used, a broken local query throws — this falls back to
 * {@link listEpisodeHealthMarkersForEpisode} so online Supabase reads still work (same pattern as
 * Home/Manage local-read failure handling). If the local read succeeds but returns an empty list,
 * this performs a Supabase verification read and prefers remote rows when available; that avoids
 * treating an initialized-but-not-yet-synced replica as authoritative. When verification fails (e.g.
 * network), this returns that failure instead of `ok: true` with empty local rows — before first
 * sync, empty SQLite cannot be told apart from truly empty without a successful remote read.
 * Thrown verification failures (e.g. transport) return `ok: false` — they must not fall through to
 * the outer fallback fetch, which could otherwise yield a misleading empty success.
 *
 * @param client - Mobile Supabase client (used when the replica is not used or local read throws).
 * @param powerSyncDb - Open PowerSync DB when offline-first writes are active.
 * @param episodeId - Target episode id.
 * @param options - Optional `limit` (same semantics as {@link listEpisodeHealthMarkersForEpisode}).
 */
export async function listEpisodeHealthMarkersForEpisodeOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  options: { limit?: number } = {},
): Promise<ListEpisodeHealthMarkersOfflineFirstResult> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    try {
      const data = await listEpisodeHealthMarkersForEpisodeFromPowerSyncDb(
        powerSyncDb,
        episodeId,
        options.limit,
      );
      if (data.length === 0) {
        let remote: Awaited<
          ReturnType<typeof listEpisodeHealthMarkersForEpisode>
        >;
        try {
          remote = await listEpisodeHealthMarkersForEpisode(
            client,
            episodeId,
            options,
          );
        } catch (caught) {
          return { ok: false, error: toPresetDataError(caught) };
        }
        if (remote.ok && remote.data.length > 0) {
          return {
            ok: true,
            data: remote.data,
            markersReadFromLocalReplica: false,
          };
        }
        if (!remote.ok) {
          return remote;
        }
      }
      return {
        ok: true,
        data,
        markersReadFromLocalReplica: true,
      };
    } catch {
      const remote = await listEpisodeHealthMarkersForEpisode(
        client,
        episodeId,
        options,
      );
      if (!remote.ok) {
        return remote;
      }
      return {
        ok: true,
        data: remote.data,
        markersReadFromLocalReplica: false,
      };
    }
  }
  const remote = await listEpisodeHealthMarkersForEpisode(
    client,
    episodeId,
    options,
  );
  if (!remote.ok) {
    return remote;
  }
  return {
    ok: true,
    data: remote.data,
    markersReadFromLocalReplica: false,
  };
}

/**
 * Completes the post–health-marker episode step offline-first.
 */
export async function completeEpisodePostMarkerStepOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  fields: EpisodePostMarkerStepWrite,
): Promise<PresetDataResult<EpisodeRow>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return completeEpisodePostMarkerStepPowerSyncDb(
      powerSyncDb,
      episodeId,
      fields,
    );
  }
  return completeEpisodePostMarkerStep(client, episodeId, fields);
}

/**
 * Ends an active episode offline-first.
 */
export async function endEpisodeIfStillActiveOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  endedAt?: string,
  startedAt?: string,
): Promise<PresetDataResult<{ didEnd: boolean }>> {
  return episodeDestructiveMutationOfflineFirst(
    client,
    powerSyncDb,
    'didEnd',
    (c) => endEpisodeIfStillActive(c, episodeId, endedAt, startedAt),
    (db) =>
      endEpisodeIfStillActivePowerSyncDb(db, episodeId, endedAt, startedAt),
  );
}

/**
 * When the mirror is not trusted for empty lists, an `ok` + empty Supabase result while NetInfo is
 * explicitly offline is not treated as authoritative (cold offline / pre-first-sync).
 *
 * @param trustEmptyLocalReplica - When true, empty remote rows are always accepted.
 * @param remote - Result from {@link listFoodDiaryEntriesForEpisode}.
 * @returns A network error result to surface, or `null` to keep `remote`.
 */
async function foodDiaryEmptyRemoteRejectedWhenOfflineAndMirrorUntrusted(
  trustEmptyLocalReplica: boolean,
  remote: PresetDataResult<FoodDiaryEntryRow[]>,
): Promise<PresetDataResult<FoodDiaryEntryRow[]> | null> {
  if (trustEmptyLocalReplica || !remote.ok || remote.data.length > 0) {
    return null;
  }
  if ((await fetchMobileDeviceIsConnected()) === false) {
    return {
      ok: false,
      error: new PresetDataError(
        'network_error',
        'Could not verify food diary on the server while offline. Connect once while online so this device can sync, then try again.',
        new TypeError('Network request failed'),
      ),
    };
  }
  return null;
}

/**
 * Lists food diary entries for an episode offline-first.
 *
 * When PowerSync is used, a failed local list (`ok: false` from SQLite, or an unexpected throw)
 * falls back to {@link listFoodDiaryEntriesForEpisode} so online Supabase reads still work, matching
 * {@link listEpisodeHealthMarkersForEpisodeOfflineFirst}. If the local read succeeds but is empty,
 * this verifies with Supabase and prefers remote rows when available (avoids treating a
 * pre-first-sync replica as authoritative). When `trustEmptyLocalReplica` is true (caller should
 * align this with `powerSyncOfflineReplicaReadsEnabled` on the session bridge), skip that verification so a
 * legitimately empty episode does not fail offline. When `trustEmptyLocalReplica` is false, a failed
 * verification (including transport `network_error`) returns `{ ok: false, error }` — it must not
 * fall back to an empty local success, or a cold offline open with an initialized-but-not-yet-synced
 * replica would hide server rows. The same applies when Supabase returns **`ok` + `[]`** while NetInfo
 * is explicitly offline (untrusted mirror). Thrown verification errors return `{ ok: false, error }` and must
 * not hit the outer SQLite fallback, which could return misleading empty success for a broken local
 * query path.
 */
export async function listFoodDiaryEntriesForEpisodeOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  options: { limit?: number; trustEmptyLocalReplica?: boolean } = {},
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  const trustEmptyLocalReplica = options.trustEmptyLocalReplica === true;
  const listOptions =
    options.limit != null ? { limit: options.limit } : undefined;

  if (powerSyncWritesEnabled(powerSyncDb)) {
    try {
      const local = await listFoodDiaryEntriesForEpisodePowerSyncDb(
        powerSyncDb,
        episodeId,
        options.limit ?? 50,
      );
      if (!local.ok) {
        const remoteFallback = await listFoodDiaryEntriesForEpisode(
          client,
          episodeId,
          listOptions ?? {},
        );
        const gated =
          await foodDiaryEmptyRemoteRejectedWhenOfflineAndMirrorUntrusted(
            trustEmptyLocalReplica,
            remoteFallback,
          );
        return gated ?? remoteFallback;
      }
      if (local.data.length > 0) {
        return local;
      }
      if (trustEmptyLocalReplica) {
        return local;
      }
      let remote: PresetDataResult<FoodDiaryEntryRow[]>;
      try {
        remote = await listFoodDiaryEntriesForEpisode(
          client,
          episodeId,
          listOptions ?? {},
        );
      } catch (caught) {
        return { ok: false, error: toPresetDataError(caught) };
      }
      if (remote.ok && remote.data.length > 0) {
        return remote;
      }
      if (!remote.ok) {
        return remote;
      }
      const emptyOfflineUntrusted =
        await foodDiaryEmptyRemoteRejectedWhenOfflineAndMirrorUntrusted(
          trustEmptyLocalReplica,
          remote,
        );
      return emptyOfflineUntrusted ?? remote;
    } catch {
      return await listFoodDiaryEntriesForEpisode(
        client,
        episodeId,
        listOptions ?? {},
      );
    }
  }
  return listFoodDiaryEntriesForEpisode(client, episodeId, listOptions ?? {});
}

/**
 * Creates a food diary entry offline-first.
 */
export async function createFoodDiaryEntryOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  row: FoodDiaryEntryInsert,
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const core = validateAndNormalizeFoodDiaryCreateCore(row);
  if (!core.ok) {
    return core;
  }
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return insertFoodDiaryEntryPowerSyncDb(powerSyncDb, row, {
      food_note: core.food_note,
      logged_at: core.logged_at,
    });
  }
  return createFoodDiaryEntry(client, {
    ...row,
    food_note: core.food_note,
    logged_at: core.logged_at,
  });
}

/**
 * Updates a food diary entry offline-first.
 */
export async function updateFoodDiaryEntryOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  entryId: Uuid,
  patch: FoodDiaryEntryUpdate,
): Promise<PresetDataResult<FoodDiaryEntryRow>> {
  const normalized = normalizeFoodDiaryEntryUpdate(patch);
  if (!normalized.ok) {
    return normalized;
  }
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return updateFoodDiaryEntryPowerSyncDb(
      powerSyncDb,
      entryId,
      normalized.data,
    );
  }
  return updateFoodDiaryEntry(client, entryId, normalized.data);
}

/**
 * Deletes a food diary entry offline-first. The PowerSync path returns `data: false` when no row
 * matched (same contract as {@link deleteFoodDiaryEntry} with `maybeSingle()`).
 */
export async function deleteFoodDiaryEntryOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  entryId: Uuid,
): Promise<PresetDataResult<boolean>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return deleteFoodDiaryEntryPowerSyncDb(powerSyncDb, entryId);
  }
  return deleteFoodDiaryEntry(client, entryId);
}

/**
 * Deletes the current-pass symptom answer offline-first (PowerSync when the replica is open).
 *
 * @param client - Mobile Supabase client (used when PowerSync writes are not active).
 * @param powerSyncDb - Open PowerSync DB when offline-first writes are enabled.
 * @param args - Same args as {@link deleteCurrentPassEpisodeSymptomAnswer}; `episodeMediaPathHints`
 *   are only used on the Supabase path (Storage cleanup).
 */
export async function deleteCurrentPassEpisodeSymptomAnswerOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  args: {
    episodeId: Uuid;
    presetSymptomId: Uuid;
    lastPostMarkerStepCompletedAt: string | null;
    episodeMediaPathHints?: (string | null | undefined)[];
  },
): Promise<PresetDataResult<boolean>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return deleteCurrentPassEpisodeSymptomAnswerPowerSyncDb(powerSyncDb, {
      episodeId: args.episodeId,
      presetSymptomId: args.presetSymptomId,
      lastPostMarkerStepCompletedAt: args.lastPostMarkerStepCompletedAt,
    });
  }
  return deleteCurrentPassEpisodeSymptomAnswer(client, args);
}

/**
 * Cancels an active episode offline-first.
 *
 * @param client - Mobile Supabase client.
 * @param powerSyncDb - Open PowerSync DB when offline-first writes are enabled.
 * @param episodeId - Episode to cancel.
 */
export async function cancelActiveEpisodeByIdOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
): Promise<CancelActiveEpisodeByIdResult> {
  return episodeDestructiveMutationOfflineFirst(
    client,
    powerSyncDb,
    'didCancel',
    (c) => cancelActiveEpisodeById(c, episodeId),
    (db) => cancelActiveEpisodeByIdPowerSyncDb(db, episodeId),
  );
}

/**
 * Deletes an episode from history (or active) offline-first.
 *
 * @param client - Mobile Supabase client.
 * @param powerSyncDb - Open PowerSync DB when offline-first writes are enabled.
 * @param episodeId - Episode to delete.
 */
export async function deleteEpisodeByIdOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
): Promise<DeleteEpisodeByIdResult> {
  return episodeDestructiveMutationOfflineFirst(
    client,
    powerSyncDb,
    'didDelete',
    (c) => deleteEpisodeById(c, episodeId),
    (db) => deleteEpisodeByIdPowerSyncDb(db, episodeId),
  );
}
