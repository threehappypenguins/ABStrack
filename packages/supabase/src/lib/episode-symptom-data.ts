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
 * Moves `episode_media` rows off duplicate `episode_symptoms` ids before those rows are deleted.
 * `episode_media_symptom_step_fk` is `ON DELETE CASCADE`; without this, storage metadata would be
 * dropped with the duplicate symptom row.
 *
 * @internal
 */
async function reassignEpisodeMediaToCanonicalSymptomRow(
  client: AbstrackSupabaseClient,
  args: {
    episodeId: Uuid;
    canonicalEpisodeSymptomId: Uuid;
    duplicateEpisodeSymptomIds: Uuid[];
  },
): Promise<{ error: unknown }> {
  const { episodeId, canonicalEpisodeSymptomId, duplicateEpisodeSymptomIds } =
    args;
  if (duplicateEpisodeSymptomIds.length === 0) {
    return { error: null };
  }
  const r = await client
    .from('episode_media')
    .update({ episode_symptom_id: canonicalEpisodeSymptomId })
    .eq('episode_id', episodeId)
    .in('episode_symptom_id', duplicateEpisodeSymptomIds);
  return { error: r.error };
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

/** User-facing copy when dedupe fails on the initial fetch path. */
const DUPLICATE_SYMPTOM_CONFLICT_FIX =
  'Could not fix duplicate symptom entries. Try again or contact support.';

/** User-facing copy when dedupe fails after a unique race on insert. */
const DUPLICATE_SYMPTOM_CONFLICT_SAVE =
  'Could not save this symptom answer. Try again.';

/**
 * If `rows` has more than one line for the same preset step (newest first), repoints
 * `episode_media`, deletes duplicate `episode_symptoms` rows, and returns `[canonical]`.
 * Otherwise returns `rows` unchanged.
 *
 * @internal
 */
async function dedupeEpisodeSymptomRowsForLine(
  client: AbstrackSupabaseClient,
  episodeId: Uuid,
  rows: EpisodeSymptomRow[],
  conflictMessage: string,
): Promise<
  | { ok: true; rows: EpisodeSymptomRow[] }
  | { ok: false; error: PresetDataError }
> {
  if (rows.length <= 1) {
    return { ok: true, rows };
  }
  const canonicalId = rows[0].id;
  const duplicateIds = rows.slice(1).map((r) => r.id);

  const { error: mediaError } = await reassignEpisodeMediaToCanonicalSymptomRow(
    client,
    {
      episodeId,
      canonicalEpisodeSymptomId: canonicalId,
      duplicateEpisodeSymptomIds: duplicateIds,
    },
  );
  if (mediaError) {
    return {
      ok: false,
      error: new PresetDataError('conflict', conflictMessage, mediaError),
    };
  }
  const { error: delError } = await deleteEpisodeSymptomRowsByIds(
    client,
    duplicateIds,
  );
  if (delError) {
    return {
      ok: false,
      error: new PresetDataError('conflict', conflictMessage, delError),
    };
  }
  return { ok: true, rows: [rows[0]] };
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
 * by `created_at` / `id`, repoints `episode_media` off duplicate ids (CASCADE), deletes the rest,
 * then updates. Values are plaintext columns under RLS.
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

    const initialDedupe = await dedupeEpisodeSymptomRowsForLine(
      client,
      episodeId,
      rows,
      DUPLICATE_SYMPTOM_CONFLICT_FIX,
    );
    if (!initialDedupe.ok) {
      return { data: null, error: initialDedupe.error };
    }
    rows = initialDedupe.rows;

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
      const raceDedupe = await dedupeEpisodeSymptomRowsForLine(
        client,
        episodeId,
        r2,
        DUPLICATE_SYMPTOM_CONFLICT_SAVE,
      );
      if (!raceDedupe.ok) {
        return { data: null, error: raceDedupe.error };
      }
      r2 = raceDedupe.rows;
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
