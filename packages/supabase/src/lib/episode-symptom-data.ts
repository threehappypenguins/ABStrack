import type {
  EpisodeSymptomRow,
  PresetSymptomRow,
  SymptomPromptAnswer,
  Uuid,
} from '@abstrack/types';
import { symptomPromptAnswerToResponseColumns } from '@abstrack/types';
import { PresetDataError } from './preset-data-error.js';
import type { PresetDataResult } from './preset-data.js';
import { wrap } from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

function isPostgresUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}

/**
 * Loads all `episode_symptoms` rows for one episode step, newest first (canonical row is first).
 *
 * @internal
 */
async function fetchEpisodeSymptomRowsForLine(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  presetSymptomId: Uuid,
): Promise<{ data: EpisodeSymptomRow[]; error: unknown }> {
  const r = await client
    .from('episode_symptoms')
    .select('*')
    .eq('episode_id', episodeId)
    .eq('preset_symptom_id', presetSymptomId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });
  return {
    data: (r.data ?? []) as EpisodeSymptomRow[],
    error: r.error,
  };
}

/**
 * Deletes duplicate rows by id (keeps the canonical row outside this call).
 *
 * @internal
 */
async function deleteEpisodeSymptomRowsByIds(
  client: AbstrackSupabaseClient,
  ids: Uuid[],
): Promise<{ error: unknown }> {
  if (ids.length === 0) {
    return { error: null };
  }
  return client.from('episode_symptoms').delete().in('id', ids);
}

/**
 * Lists logged symptom rows for one episode (preset order, then stable duplicate ordering).
 *
 * Orders by `sort_order` ASC, then `created_at` DESC, then `id` DESC so legacy duplicate rows for the
 * same preset line list the canonical row first (same tie-break as upsert / migration / client map).
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
      .order('created_at', { ascending: false })
      .order('id', { ascending: false });
    return {
      data: (r.data ?? []) as EpisodeSymptomRow[],
      error: r.error,
    };
  });
}

/**
 * Inserts or updates one `episode_symptoms` row for a preset line (one row per episode + preset line).
 * If multiple rows exist for the same pair (legacy data or pre-migration races), keeps the newest row
 * by `created_at` / `id` and deletes the rest before updating. Values are plaintext columns under RLS.
 *
 * @param client - Supabase client (RLS applies).
 * @param args.userId - Must match the episode owner (`episodes.user_id`) for patient-owned episodes.
 * @param args.episodeId - `episodes.id`.
 * @param args.line - Active preset symptom line (defines `preset_symptom_id`, name, sort order).
 * @param args.answer - Current answer for that line (`answer.type` must match `line.response_type`).
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

  if (answer.type !== line.response_type) {
    return {
      ok: false,
      error: new PresetDataError(
        'validation_error',
        'Answer type does not match this symptom line.',
      ),
    };
  }

  const response = symptomPromptAnswerToResponseColumns(answer);

  const responsePayload = {
    symptom_name: line.symptom_name,
    sort_order: line.sort_order,
    response_type: response.response_type,
    response_boolean: response.response_boolean,
    response_severity: response.response_severity,
    response_text: response.response_text,
  };

  return wrap(async () => {
    const fetched = await fetchEpisodeSymptomRowsForLine(
      client,
      episodeId,
      line.id,
    );
    if (fetched.error) {
      return { data: null, error: fetched.error };
    }

    let rows = fetched.data;

    if (rows.length > 1) {
      const duplicateIds = rows.slice(1).map((r) => r.id);
      const { error: delError } = await deleteEpisodeSymptomRowsByIds(
        client,
        duplicateIds,
      );
      if (delError) {
        return {
          data: null,
          error: new PresetDataError(
            'conflict',
            'Could not fix duplicate symptom entries. Try again or contact support.',
            delError,
          ),
        };
      }
      rows = [rows[0]];
    }

    if (rows.length === 1) {
      const upd = await client
        .from('episode_symptoms')
        .update(responsePayload)
        .eq('id', rows[0].id)
        .select('*')
        .single();
      return {
        data: upd.data as EpisodeSymptomRow | null,
        error: upd.error,
      };
    }

    const ins = await client
      .from('episode_symptoms')
      .insert({
        user_id: userId,
        episode_id: episodeId,
        preset_symptom_id: line.id,
        ...responsePayload,
      })
      .select('*')
      .single();

    if (ins.error && isPostgresUniqueViolation(ins.error)) {
      const afterRace = await fetchEpisodeSymptomRowsForLine(
        client,
        episodeId,
        line.id,
      );
      if (afterRace.error) {
        return { data: null, error: afterRace.error };
      }
      let r2 = afterRace.data;
      if (r2.length > 1) {
        const duplicateIds = r2.slice(1).map((r) => r.id);
        const { error: delError } = await deleteEpisodeSymptomRowsByIds(
          client,
          duplicateIds,
        );
        if (delError) {
          return {
            data: null,
            error: new PresetDataError(
              'conflict',
              'Could not save this symptom answer. Try again.',
              delError,
            ),
          };
        }
        r2 = [r2[0]];
      }
      if (r2.length === 0) {
        return { data: null, error: ins.error };
      }
      const upd = await client
        .from('episode_symptoms')
        .update(responsePayload)
        .eq('id', r2[0].id)
        .select('*')
        .single();
      return {
        data: upd.data as EpisodeSymptomRow | null,
        error: upd.error,
      };
    }

    return {
      data: ins.data as EpisodeSymptomRow | null,
      error: ins.error,
    };
  });
}
