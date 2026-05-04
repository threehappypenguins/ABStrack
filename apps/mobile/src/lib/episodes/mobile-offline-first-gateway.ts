/**
 * Routes episode-flow mutations to PowerSync SQLite when the replica is available (offline-first),
 * otherwise uses Supabase REST (same RLS) when PowerSync is not configured on this install.
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
  PresetDataError,
} from '@abstrack/supabase';
import type { PresetDataResult } from '@abstrack/supabase';
import {
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
  updateFoodDiaryEntry,
  validateAndNormalizeFoodDiaryCreateCore,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

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
 * Home/Manage local-read failure handling).
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
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return endEpisodeIfStillActivePowerSyncDb(
      powerSyncDb,
      episodeId,
      endedAt,
      startedAt,
    );
  }
  return endEpisodeIfStillActive(client, episodeId, endedAt, startedAt);
}

/**
 * Lists food diary entries for an episode offline-first.
 *
 * When PowerSync is used, a failed local list (`ok: false` from SQLite, or an unexpected throw)
 * falls back to {@link listFoodDiaryEntriesForEpisode} so online Supabase reads still work, matching
 * {@link listEpisodeHealthMarkersForEpisodeOfflineFirst}.
 */
export async function listFoodDiaryEntriesForEpisodeOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  options: { limit?: number } = {},
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    try {
      const local = await listFoodDiaryEntriesForEpisodePowerSyncDb(
        powerSyncDb,
        episodeId,
        options.limit ?? 50,
      );
      if (local.ok) {
        return local;
      }
    } catch {
      /* fall through to Supabase */
    }
    return listFoodDiaryEntriesForEpisode(client, episodeId, options);
  }
  return listFoodDiaryEntriesForEpisode(client, episodeId, options);
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
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return cancelActiveEpisodeByIdPowerSyncDb(powerSyncDb, episodeId);
  }
  return cancelActiveEpisodeById(client, episodeId);
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
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return deleteEpisodeByIdPowerSyncDb(powerSyncDb, episodeId);
  }
  return deleteEpisodeById(client, episodeId);
}
