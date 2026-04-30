import type { PresetSymptomRow, SymptomResponseType, Uuid } from './types.js';

/** Maximum local symptom video capture duration (15 seconds). */
export const SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS = 15000;

/**
 * Temporary local reference to a captured symptom photo (no upload key yet).
 */
export interface SymptomPromptPhotoCaptureRef {
  /** Device/browser-local URI or object URL. */
  localUri: string;
  /** ISO timestamp of when capture completed. */
  capturedAt: string;
  /**
   * After upload, `storage:{thumbnail_storage_key}` so lightweight previews use the same
   * authorization boundary as the primary photo without downloading full-resolution bytes.
   */
  thumbnailStorageUri?: string | null;
}

/**
 * Temporary local reference to a captured symptom video (no upload key yet).
 */
export interface SymptomPromptVideoCaptureRef {
  /** Device/browser-local URI or object URL. */
  localUri: string;
  /** Best-effort duration from capture API. */
  durationMs: number | null;
  /** ISO timestamp of when capture completed. */
  capturedAt: string;
  /**
   * After upload, `storage:{thumbnail_storage_key}` (JPEG poster frame) for grids and listings.
   */
  thumbnailStorageUri?: string | null;
}

/**
 * One stored answer for a preset symptom line during episode symptom traversal.
 * Values are JSON-serializable for session persistence (web `sessionStorage`).
 * Photo/video may hold temporary local capture metadata until upload exists.
 */
export type SymptomPromptAnswer =
  | { type: 'yes_no'; value: boolean | null }
  | { type: 'severity_scale'; value: number | null }
  | { type: 'free_text'; value: string }
  | { type: 'photo'; value: SymptomPromptPhotoCaptureRef | null }
  | { type: 'video'; value: SymptomPromptVideoCaptureRef | null };

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
      return (
        answer.value !== null &&
        answer.value.localUri.trim().length > 0 &&
        Number.isFinite(Date.parse(answer.value.capturedAt))
      );
    case 'video':
      return (
        answer.value !== null &&
        answer.value.localUri.trim().length > 0 &&
        Number.isFinite(Date.parse(answer.value.capturedAt))
      );
    default: {
      const _exhaustive: never = answer;
      return _exhaustive;
    }
  }
}

/**
 * Whether local session storage has meaningful traversal state (not the default empty session).
 * Used to prefer the saved step index when resuming an episode on the same device.
 *
 * @param session - Stored session for one episode.
 * @returns `true` when the user advanced past the first step and/or has draft answers keyed by line.
 */
export function hasSymptomSessionTraversalProgress(
  session: SymptomPromptSessionState,
): boolean {
  if (session.activeIndex > 0) {
    return true;
  }
  return Object.keys(session.answers).length > 0;
}

/**
 * Picks the step index and completion phase when entering the symptom flow from a “resume” entry
 * (e.g. home), using merged server + local answers. Walks preset lines in order and stops at the
 * first line without a meaningful answer; if every line is filled, returns the last index and
 * `complete` so the UI can show the completion state.
 *
 * @param lines - Ordered preset symptom lines for the episode’s symptom preset.
 * @param mergedAnswers - Server-backed answers overlaid with session drafts.
 * @returns Active index and whether the list is already complete.
 */
export function computeSymptomResumePlacement(
  lines: PresetSymptomRow[],
  mergedAnswers: SymptomPromptAnswers,
): { activeIndex: number; phase: 'prompting' | 'complete' } {
  if (lines.length === 0) {
    return { activeIndex: 0, phase: 'prompting' };
  }
  const firstUnanswered = lines.findIndex(
    (line) => !symptomPromptAnswerHasValue(mergedAnswers[line.id]),
  );
  if (firstUnanswered === -1) {
    return { activeIndex: lines.length - 1, phase: 'complete' };
  }
  return { activeIndex: firstUnanswered, phase: 'prompting' };
}
