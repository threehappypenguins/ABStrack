import type { EpisodeSymptomRow, SymptomResponseType } from './types.js';
import { filterEpisodeSymptomRowsForOpenPass } from './episode-open-pass.js';
import type {
  SymptomPromptAnswer,
  SymptomPromptAnswers,
} from './symptom-prompt-session.js';

/**
 * Maps a stored `episode_symptoms` row to the in-memory prompt answer shape (Week 5+ flows).
 *
 * @param row - Row returned from Postgres (plaintext columns under RLS).
 * @returns Serializable answer for UI state and session overlays.
 */
export function episodeSymptomRowToPromptAnswer(
  row: EpisodeSymptomRow,
): SymptomPromptAnswer {
  switch (row.response_type) {
    case 'yes_no':
      return { type: 'yes_no', value: row.response_boolean };
    case 'severity_scale':
      return { type: 'severity_scale', value: row.response_severity };
    case 'free_text':
      return { type: 'free_text', value: row.response_text ?? '' };
    case 'photo':
      return { type: 'photo', value: null };
    case 'video':
      return { type: 'video', value: null };
  }
}

/** True when `uri` is a persisted `storage:…` ref (not `blob:`, `file:`, etc.). */
function isEpisodeMediaStoragePathHint(uri: string): boolean {
  return uri.trim().startsWith('storage:');
}

/**
 * Collects primary and thumbnail `storage:…` strings from a committed photo/video answer for Storage
 * cleanup when deleting the symptom row (passed through to Supabase helpers).
 *
 * @param answer - Current prompt answer (ignored unless type is `photo` or `video` with a value).
 * @returns Trimmed `storage:…` strings only — transient capture URIs are excluded.
 */
export function episodeMediaStoragePathHintsFromPromptAnswer(
  answer: SymptomPromptAnswer | undefined,
): string[] {
  if (
    answer == null ||
    (answer.type !== 'photo' && answer.type !== 'video') ||
    answer.value == null
  ) {
    return [];
  }
  const v = answer.value;
  const out: string[] = [];
  if (typeof v.localUri === 'string') {
    const local = v.localUri.trim();
    if (local && isEpisodeMediaStoragePathHint(local)) {
      out.push(local);
    }
  }
  if (typeof v.thumbnailStorageUri === 'string') {
    const thumb = v.thumbnailStorageUri.trim();
    if (thumb && isEpisodeMediaStoragePathHint(thumb)) {
      out.push(thumb);
    }
  }
  return out;
}

/**
 * Converts a prompt answer into `episode_symptoms` response columns (CHECK-aligned).
 *
 * @param answer - Current draft from the prompt UI.
 */
export function symptomPromptAnswerToResponseColumns(
  answer: SymptomPromptAnswer,
): {
  response_type: SymptomResponseType;
  response_boolean: boolean | null;
  response_severity: number | null;
  response_text: string | null;
} {
  switch (answer.type) {
    case 'yes_no':
      return {
        response_type: 'yes_no',
        response_boolean: answer.value,
        response_severity: null,
        response_text: null,
      };
    case 'severity_scale':
      return {
        response_type: 'severity_scale',
        response_boolean: null,
        response_severity: answer.value,
        response_text: null,
      };
    case 'free_text':
      return {
        response_type: 'free_text',
        response_boolean: null,
        response_severity: null,
        response_text: answer.value,
      };
    case 'photo':
      return {
        response_type: 'photo',
        response_boolean: null,
        response_severity: null,
        response_text: null,
      };
    case 'video':
      return {
        response_type: 'video',
        response_boolean: null,
        response_severity: null,
        response_text: null,
      };
  }
}

/**
 * Prefer `a` over `b` when both rows are for the same preset line — matches upsert/dedupe
 * (`created_at` DESC, `id` DESC) so hydration agrees with the canonical DB row.
 */
function episodeSymptomRowIsCanonicalOver(
  a: EpisodeSymptomRow,
  b: EpisodeSymptomRow,
): boolean {
  const ta = new Date(a.created_at).getTime();
  const tb = new Date(b.created_at).getTime();
  if (ta !== tb) {
    return ta > tb;
  }
  return a.id > b.id;
}

/**
 * Picks the canonical `episode_symptoms` row per `preset_symptom_id` (newest `created_at`, then
 * `id` DESC) from an already filtered list — same rule as {@link episodeSymptomRowsToAnswersMap}.
 *
 * @param rows - Symptom rows to dedupe (e.g. open-pass only).
 * @returns Map keyed by `preset_symptoms.id` to the winning row.
 */
function pickCanonicalEpisodeSymptomRowsByPresetLine(
  rows: EpisodeSymptomRow[],
): Record<string, EpisodeSymptomRow> {
  const canonicalByPreset: Record<string, EpisodeSymptomRow> = {};
  for (const row of rows) {
    if (!row.preset_symptom_id) {
      continue;
    }
    const key = row.preset_symptom_id;
    const prev = canonicalByPreset[key];
    if (!prev || episodeSymptomRowIsCanonicalOver(row, prev)) {
      canonicalByPreset[key] = row;
    }
  }
  return canonicalByPreset;
}

/**
 * Builds {@link SymptomPromptAnswers} from persisted episode symptom rows (keyed by `preset_symptoms.id`).
 *
 * If multiple rows share a `preset_symptom_id` (legacy duplicates), keeps the same canonical row as
 * server upsert / the unique-index migration: newest `created_at`, then `id` DESC.
 *
 * @param rows - Rows for one episode (same owner as the episode under RLS).
 */
export function episodeSymptomRowsToAnswersMap(
  rows: EpisodeSymptomRow[],
): SymptomPromptAnswers {
  const canonicalByPreset = pickCanonicalEpisodeSymptomRowsByPresetLine(rows);
  const out: SymptomPromptAnswers = {};
  for (const [presetId, row] of Object.entries(canonicalByPreset)) {
    out[presetId] = episodeSymptomRowToPromptAnswer(row);
  }
  return out;
}

/**
 * Canonical `episode_symptoms` row per preset line within the **current open pass** (same filter as
 * {@link episodeSymptomRowsToAnswersMapForOpenPass}). Use when joining to `episode_media` by
 * `episode_symptom_id` so hydration never applies Storage from a superseded row.
 *
 * @param rows - All `episode_symptoms` rows for the episode.
 * @param lastPostMarkerStepCompletedAt - `episodes.post_marker_step_completed_at` (ISO), or null.
 * @returns Map keyed by `preset_symptoms.id` to the canonical row for that line in the pass.
 */
export function canonicalOpenPassEpisodeSymptomRowsByPresetLine(
  rows: EpisodeSymptomRow[],
  lastPostMarkerStepCompletedAt: string | null,
): Record<string, EpisodeSymptomRow> {
  return pickCanonicalEpisodeSymptomRowsByPresetLine(
    filterEpisodeSymptomRowsForOpenPass(rows, lastPostMarkerStepCompletedAt),
  );
}

/**
 * Like {@link episodeSymptomRowsToAnswersMap}, but only includes rows from the current open pass
 * (after the last `post_marker_step_completed_at` Save and continue, if any).
 *
 * @param rows - All `episode_symptoms` rows for the episode.
 * @param lastPostMarkerStepCompletedAt - `episodes.post_marker_step_completed_at` (ISO), or null.
 */
export function episodeSymptomRowsToAnswersMapForOpenPass(
  rows: EpisodeSymptomRow[],
  lastPostMarkerStepCompletedAt: string | null,
): SymptomPromptAnswers {
  const canonicalByPreset = canonicalOpenPassEpisodeSymptomRowsByPresetLine(
    rows,
    lastPostMarkerStepCompletedAt,
  );
  const out: SymptomPromptAnswers = {};
  for (const [presetId, row] of Object.entries(canonicalByPreset)) {
    out[presetId] = episodeSymptomRowToPromptAnswer(row);
  }
  return out;
}
