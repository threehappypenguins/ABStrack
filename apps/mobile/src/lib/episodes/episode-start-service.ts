/**
 * Episode start persistence: inserts an `episodes` row with preset ids resolved from a template.
 */
import type { EpisodeRow } from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import { createEpisode } from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

import {
  buildNewEpisodePowerSyncInsertArgs,
  insertEpisodeRowIntoPowerSync,
} from '../powersync/episode-flow-powersync-writes';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Creates an episode row with `symptom_preset_id` and `health_marker_preset_id` set (typically the
 * pair taken from an episode template or an explicit picker).
 *
 * When {@link SaveEpisodeWithTemplatePresetsArgs.powerSyncDatabase} is set (encrypted replica open),
 * the row is inserted locally and queued for upload to Supabase when online.
 *
 * @param args - Insert payload.
 * @param args.userId - Authenticated user id for `episodes.user_id` (must satisfy RLS).
 * @param args.symptomPresetId - `symptom_presets.id`.
 * @param args.healthMarkerPresetId - `health_marker_presets.id`.
 */
export type SaveEpisodeWithTemplatePresetsArgs = {
  userId: string;
  symptomPresetId: string;
  healthMarkerPresetId: string;
  /** When present, offline-first insert via PowerSync SQLite + upload queue. */
  powerSyncDatabase?: PowerSyncDatabase | null;
};

export function saveEpisodeWithTemplatePresets(
  args: SaveEpisodeWithTemplatePresetsArgs,
): Promise<PresetDataResult<EpisodeRow>> {
  const startedAt = new Date().toISOString();
  if (args.powerSyncDatabase) {
    const payload = buildNewEpisodePowerSyncInsertArgs({
      userId: args.userId,
      symptomPresetId: args.symptomPresetId,
      healthMarkerPresetId: args.healthMarkerPresetId,
      startedAt,
    });
    return insertEpisodeRowIntoPowerSync(args.powerSyncDatabase, payload);
  }
  return createEpisode(getMobileSupabaseClient(), {
    user_id: args.userId,
    started_at: startedAt,
    symptom_preset_id: args.symptomPresetId,
    health_marker_preset_id: args.healthMarkerPresetId,
  });
}
