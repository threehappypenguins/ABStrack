import type { SymptomResponseType, Uuid } from './types.js';

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

/**
 * Builds the empty/default answer shape for a response type.
 *
 * @param type - Symptom response type configured on the preset line.
 * @returns Empty answer payload for UI/session initialization and "skip/clear" behavior.
 */
export function createDefaultSymptomPromptAnswer(
  type: SymptomResponseType,
): SymptomPromptAnswer {
  switch (type) {
    case 'yes_no':
      return { type: 'yes_no', value: null };
    case 'severity_scale':
      return { type: 'severity_scale', value: null };
    case 'free_text':
      return { type: 'free_text', value: '' };
    case 'photo':
      return { type: 'photo', value: null };
    case 'video':
      return { type: 'video', value: null };
    default: {
      const _exhaustive: never = type;
      return _exhaustive;
    }
  }
}

/**
 * Indicates whether an answer is meaningfully filled for gating next-step actions.
 *
 * @param answer - Current in-memory answer for a symptom line.
 * @returns `true` when the user has provided a value (not null/empty), else `false`.
 */
export function symptomPromptAnswerHasValue(
  answer: SymptomPromptAnswer | undefined,
): boolean {
  if (!answer) {
    return false;
  }
  switch (answer.type) {
    case 'yes_no':
      return answer.value !== null;
    case 'severity_scale':
      return answer.value !== null;
    case 'free_text':
      return answer.value.trim().length > 0;
    case 'photo':
    case 'video':
      return false;
    default: {
      const _exhaustive: never = answer;
      return _exhaustive;
    }
  }
}
