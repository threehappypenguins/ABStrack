import type {
  EpisodeSymptomRow,
  PresetSymptomRow,
  SymptomPromptAnswer,
  Uuid,
} from '@abstrack/types';
import { symptomPromptAnswerToResponseColumns } from '@abstrack/types';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Lists logged symptom rows for one episode (ordered like the preset).
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 */
export async function listEpisodeSymptomsForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
): Promise<PresetDataResult<EpisodeSymptomRow[]>> {
  return wrap(async () => {
    const r = await client
      .from('episode_symptoms')
      .select('*')
      .eq('episode_id', episodeId)
      .order('sort_order', { ascending: true })
      .order('id', { ascending: true });
    return {
      data: (r.data ?? []) as EpisodeSymptomRow[],
      error: r.error,
    };
  });
}

/**
 * Inserts or updates one `episode_symptoms` row for a preset line (one row per episode + preset line).
 * Values are stored as plaintext columns under RLS (no client-side encryption).
 *
 * @param client - Supabase client (RLS applies).
 * @param args.userId - Must match the episode owner (`episodes.user_id`) for patient-owned episodes.
 * @param args.episodeId - `episodes.id`.
 * @param args.line - Active preset symptom line (defines `preset_symptom_id`, name, sort order).
 * @param args.answer - Current answer for that line.
 */
export async function upsertEpisodeSymptomAnswer(
  client: AbstrackSupabaseClient,
  args: {
    userId: Uuid;
    episodeId: Uuid;
    line: PresetSymptomRow;
    answer: SymptomPromptAnswer;
  },
): Promise<PresetDataResult<EpisodeSymptomRow>> {
  const { userId, episodeId, line, answer } = args;
  const response = symptomPromptAnswerToResponseColumns(answer);

  return wrap(async () => {
    const existing = await client
      .from('episode_symptoms')
      .select('*')
      .eq('episode_id', episodeId)
      .eq('preset_symptom_id', line.id)
      .limit(2);

    if (existing.error) {
      return { data: null, error: existing.error };
    }

    const rows = (existing.data ?? []) as EpisodeSymptomRow[];
    const first = rows[0];

    if (first) {
      const upd = await client
        .from('episode_symptoms')
        .update({
          symptom_name: line.symptom_name,
          sort_order: line.sort_order,
          response_type: response.response_type,
          response_boolean: response.response_boolean,
          response_severity: response.response_severity,
          response_text: response.response_text,
        })
        .eq('id', first.id)
        .select('*')
        .single();
      return { data: upd.data as EpisodeSymptomRow | null, error: upd.error };
    }

    const ins = await client
      .from('episode_symptoms')
      .insert({
        user_id: userId,
        episode_id: episodeId,
        preset_symptom_id: line.id,
        symptom_name: line.symptom_name,
        sort_order: line.sort_order,
        response_type: response.response_type,
        response_boolean: response.response_boolean,
        response_severity: response.response_severity,
        response_text: response.response_text,
      })
      .select('*')
      .single();
    return { data: ins.data as EpisodeSymptomRow | null, error: ins.error };
  });
}
