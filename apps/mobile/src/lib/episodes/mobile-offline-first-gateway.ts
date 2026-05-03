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
  EpisodePostMarkerStepWrite,
} from '@abstrack/supabase';
import type { PresetDataResult } from '@abstrack/supabase';
import {
  completeEpisodePostMarkerStep,
  createFoodDiaryEntry,
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

import {
  completeEpisodePostMarkerStepPowerSyncDb,
  deleteFoodDiaryEntryPowerSyncDb,
  endEpisodeIfStillActivePowerSyncDb,
  insertEpisodeHealthMarkerLineIntoPowerSyncDb,
  insertEpisodeSymptomAnswerIntoPowerSyncDb,
  insertFoodDiaryEntryPowerSyncDb,
  listFoodDiaryEntriesForEpisodePowerSyncDb,
  updateFoodDiaryEntryPowerSyncDb,
} from '../powersync/episode-flow-powersync-writes';
import { listEpisodeHealthMarkersForEpisodeFromPowerSyncDb } from '../powersync/powersync-episode-flow-reads';

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
 * @param client - Mobile Supabase client (used when the replica is not used).
 * @param powerSyncDb - Open PowerSync DB when offline-first writes are active.
 * @param episodeId - Target episode id.
 * @param options - Optional `limit` (same semantics as {@link listEpisodeHealthMarkersForEpisode}).
 */
export async function listEpisodeHealthMarkersForEpisodeOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  options: { limit?: number } = {},
): Promise<PresetDataResult<HealthMarkerRow[]>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    try {
      const data = await listEpisodeHealthMarkersForEpisodeFromPowerSyncDb(
        powerSyncDb,
        episodeId,
        options.limit,
      );
      return { ok: true, data };
    } catch (caught) {
      return { ok: false, error: toPresetDataError(caught) };
    }
  }
  return listEpisodeHealthMarkersForEpisode(client, episodeId, options);
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
 */
export async function listFoodDiaryEntriesForEpisodeOfflineFirst(
  client: AbstrackSupabaseClient,
  powerSyncDb: PowerSyncDatabase | null | undefined,
  episodeId: Uuid,
  options: { limit?: number } = {},
): Promise<PresetDataResult<FoodDiaryEntryRow[]>> {
  if (powerSyncWritesEnabled(powerSyncDb)) {
    return listFoodDiaryEntriesForEpisodePowerSyncDb(
      powerSyncDb,
      episodeId,
      options.limit ?? 50,
    );
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
 * Deletes a food diary entry offline-first.
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
