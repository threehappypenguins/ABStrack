/**
 * Episode start persistence: inserts an `episodes` row with preset ids resolved from a template.
 */
import type { EpisodeRow } from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import { createEpisode } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Creates an episode row with `symptom_preset_id` and `health_marker_preset_id` set (typically the
 * pair taken from an episode template or an explicit picker).
 *
 * @param args - Insert payload.
 * @param args.userId - Authenticated user id for `episodes.user_id` (must satisfy RLS).
 * @param args.symptomPresetId - `symptom_presets.id`.
 * @param args.healthMarkerPresetId - `health_marker_presets.id`.
 */
export function saveEpisodeWithTemplatePresets(args: {
  userId: string;
  symptomPresetId: string;
  healthMarkerPresetId: string;
}): Promise<PresetDataResult<EpisodeRow>> {
  return createEpisode(getMobileSupabaseClient(), {
    user_id: args.userId,
    started_at: new Date().toISOString(),
    symptom_preset_id: args.symptomPresetId,
    health_marker_preset_id: args.healthMarkerPresetId,
  });
}
