import type { EpisodeSymptomRow, SymptomResponseType } from './types.js';
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

  const out: SymptomPromptAnswers = {};
  for (const [presetId, row] of Object.entries(canonicalByPreset)) {
    out[presetId] = episodeSymptomRowToPromptAnswer(row);
  }
  return out;
}
