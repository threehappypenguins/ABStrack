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
import {
  listEpisodeMediaBucketPathsForEpisodeSymptomIds,
  normalizedEpisodeMediaBucketKeysFromHints,
  removeEpisodeMediaStorageObjectPathsBestEffort,
} from './episode-media-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

/**
 * Inserts a new `episode_symptoms` row for one preset line (one observation per pass; time-ordered
 * history is `created_at` with `id` as tie-breaker). Does not update prior pass rows.
 * Intentional: episode observations are append-only for auditability/history, so this helper is
 * insert-only (no upsert path).
 *
 * @param client - Supabase client (RLS applies).
 * @param args.userId - Must match the episode owner (`episodes.user_id`) for patient-owned episodes.
 * @param args.episodeId - `episodes.id`.
 * @param args.line - Active preset symptom line (defines `preset_symptom_id`, name, sort order).
 * @param args.answer - Current answer for that line (`answer.type` must match `line.response_type`).
 */
export async function insertEpisodeSymptomAnswer(
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
    return {
      data: ins.data as EpisodeSymptomRow | null,
      error: ins.error,
    };
  });
}

/**
 * Lists logged symptom rows for one episode (preset order, then newest duplicate ordering).
 *
 * @param client - Supabase client (RLS applies).
 * @param episodeId - `episodes.id`.
 * @param options - Optional row ordering (`orderBy`: `preset` default, or `recent` for
 *   timeline-style newest-first reads) and optional cap (`limit`) applied after that ordering.
 */
export async function listEpisodeSymptomsForEpisode(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  options: {
    limit?: number;
    orderBy?: 'preset' | 'recent';
  } = {},
): Promise<PresetDataResult<EpisodeSymptomRow[]>> {
  const limit = options.limit;
  const orderBy = options.orderBy ?? 'preset';
  return wrap(async () => {
    let query = client
      .from('episode_symptoms')
      .select('*')
      .eq('episode_id', episodeId);
    if (orderBy === 'recent') {
      query = query
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    } else {
      query = query
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: false })
        .order('id', { ascending: false });
    }
    if (limit != null) {
      query = query.limit(limit);
    }
    const r = await query;
    return {
      data: (r.data ?? []) as EpisodeSymptomRow[],
      error: r.error,
    };
  });
}

/**
 * Deletes all `episode_symptoms` rows for a preset line that belong to the current open pass in
 * one SQL statement (used when the user skips a symptom in that pass, so the pass has no answer
 * for the line).
 *
 * @param client - Supabase client (RLS applies).
 * @param args.episodeId - `episodes.id`.
 * @param args.presetSymptomId - `preset_symptoms.id` for the current prompt line.
 * @param args.lastPostMarkerStepCompletedAt - `episodes.post_marker_step_completed_at` (or null
 *   for the first pass before any “Save and continue” on episode details).
 * @param args.episodeMediaPathHints - Optional primary/thumbnail `storage:…` strings from the client;
 *   merged with keys listed from `episode_media` when that read succeeds. Listing is best-effort for
 *   Storage paths only: if `episode_media` read fails, symptom rows are still deleted and cleanup
 *   uses hints only (or is skipped when there are no hints).
 */
export async function deleteCurrentPassEpisodeSymptomAnswer(
  client: AbstrackSupabaseClient,
  args: {
    episodeId: Uuid;
    presetSymptomId: Uuid;
    lastPostMarkerStepCompletedAt: string | null;
    episodeMediaPathHints?: (string | null | undefined)[];
  },
): Promise<PresetDataResult<boolean>> {
  const {
    episodeId,
    presetSymptomId,
    lastPostMarkerStepCompletedAt,
    episodeMediaPathHints,
  } = args;
  return wrap(async () => {
    let idQuery = client
      .from('episode_symptoms')
      .select('id')
      .eq('episode_id', episodeId)
      .eq('preset_symptom_id', presetSymptomId);

    if (lastPostMarkerStepCompletedAt != null) {
      idQuery = idQuery.gt('created_at', lastPostMarkerStepCompletedAt);
    }

    const { data: idRows, error: idErr } = await idQuery;
    if (idErr) {
      return { data: null, error: idErr };
    }

    const symptomIds = (idRows ?? [])
      .map((r: { id: string }) => r.id)
      .filter(Boolean) as Uuid[];

    const pathsListed = await listEpisodeMediaBucketPathsForEpisodeSymptomIds(
      client,
      episodeId,
      symptomIds,
    );
    const pathsFromEpisodeMedia = pathsListed.ok ? pathsListed.data : [];

    let delQuery = client
      .from('episode_symptoms')
      .delete()
      .eq('episode_id', episodeId)
      .eq('preset_symptom_id', presetSymptomId);

    if (lastPostMarkerStepCompletedAt != null) {
      delQuery = delQuery.gt('created_at', lastPostMarkerStepCompletedAt);
    }

    const { error: delError } = await delQuery;

    const hintKeys = normalizedEpisodeMediaBucketKeysFromHints(
      episodeMediaPathHints ?? [],
    );
    const mergedPaths = [
      ...new Set<string>([...pathsFromEpisodeMedia, ...hintKeys]),
    ];

    if (!delError && mergedPaths.length > 0) {
      await removeEpisodeMediaStorageObjectPathsBestEffort(client, mergedPaths);
    }

    return {
      data: delError ? null : true,
      error: delError,
    };
  });
}
