/**
 * Episode start persistence: inserts an `episodes` row with preset ids resolved from a template.
 */
import type { EpisodeRow } from '@abstrack/types';
import type { PresetDataResult } from '@abstrack/supabase';
import { createEpisode } from '@abstrack/supabase';
import { getMobileSupabaseClient } from '../supabase-wiring';

/**
 * Creates an episode row with both preset columns set (symptom + health marker from the template).
 *
 * @param args - Signed-in user id and preset ids from the chosen {@link EpisodeTemplateRow}.
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
