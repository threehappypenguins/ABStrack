import type { Uuid } from './types.js';

/**
 * One stored answer for a preset symptom line during the Week 5 traversal skeleton.
 * Values are JSON-serializable for session persistence (web `sessionStorage`).
 */
export type SymptomPromptAnswer =
  | { type: 'yes_no'; value: boolean | null }
  | { type: 'severity_scale'; value: number | null }
  | { type: 'free_text'; value: string }
  | { type: 'photo'; value: null }
  | { type: 'video'; value: null };

/**
 * Answers keyed by `preset_symptoms.id`.
 */
export type SymptomPromptAnswers = Record<Uuid, SymptomPromptAnswer>;

/**
 * Progress through the linear symptom list for one episode (in-memory / session scope).
 */
export interface SymptomPromptSessionState {
  /** Index into the ordered preset symptom list (0-based). */
  activeIndex: number;
  /** Draft answers for lines the user has visited; keys are `preset_symptoms.id`. */
  answers: SymptomPromptAnswers;
}

/**
 * Default traversal state before any user input.
 *
 * @returns Initial {@link SymptomPromptSessionState}.
 */
export function createInitialSymptomPromptSession(): SymptomPromptSessionState {
  return { activeIndex: 0, answers: {} };
}
