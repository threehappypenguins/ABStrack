import type {
  SymptomPromptAnswer,
  SymptomPromptAnswers,
  SymptomPromptSessionState,
  Uuid,
} from '@abstrack/types';
import { createInitialSymptomPromptSession } from '@abstrack/types';

/**
 * In-memory session store so symptom prompt progress survives leaving and re-opening the
 * prompt screen during one app session (same episode id).
 */
const sessions = new Map<Uuid, SymptomPromptSessionState>();

function sanitizeActiveIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Keeps only well-shaped {@link SymptomPromptAnswer} values so malformed in-memory state cannot crash the UI.
 */
function sanitizeAnswerEntry(value: unknown): SymptomPromptAnswer | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }
  const o = value as Record<string, unknown>;
  const t = o.type;
  if (
    t !== 'yes_no' &&
    t !== 'severity_scale' &&
    t !== 'free_text' &&
    t !== 'photo' &&
    t !== 'video'
  ) {
    return null;
  }
  const v = o.value;
  switch (t) {
    case 'yes_no':
      if (typeof v === 'boolean' || v === null) {
        return { type: 'yes_no', value: v };
      }
      return null;
    case 'severity_scale':
      if (v === null || (typeof v === 'number' && Number.isFinite(v))) {
        return { type: 'severity_scale', value: v };
      }
      return null;
    case 'free_text':
      if (typeof v === 'string') {
        return { type: 'free_text', value: v };
      }
      return null;
    case 'photo':
      if (v === null) {
        return { type: 'photo', value: null };
      }
      return null;
    case 'video':
      if (v === null) {
        return { type: 'video', value: null };
      }
      return null;
    default:
      return null;
  }
}

function sanitizeAnswers(answers: unknown): SymptomPromptAnswers {
  if (
    typeof answers !== 'object' ||
    answers === null ||
    Array.isArray(answers)
  ) {
    return {};
  }
  const out: SymptomPromptAnswers = {};
  for (const [key, val] of Object.entries(answers)) {
    const cleaned = sanitizeAnswerEntry(val);
    if (cleaned !== null) {
      out[key] = cleaned;
    }
  }
  return out;
}

function sanitizeStoredState(
  raw: SymptomPromptSessionState,
): SymptomPromptSessionState {
  if (
    typeof raw.answers !== 'object' ||
    raw.answers === null ||
    Array.isArray(raw.answers)
  ) {
    return createInitialSymptomPromptSession();
  }
  const activeIndex = sanitizeActiveIndex(raw.activeIndex);
  if (activeIndex === null) {
    return createInitialSymptomPromptSession();
  }
  return { activeIndex, answers: sanitizeAnswers(raw.answers) };
}

/**
 * Reads traversal state for an episode, or returns a fresh initial state.
 *
 * @param episodeId - `episodes.id`.
 * @returns Persisted state or {@link createInitialSymptomPromptSession}.
 */
export function getSymptomPromptSession(
  episodeId: string,
): SymptomPromptSessionState {
  const raw = sessions.get(episodeId);
  if (!raw) {
    return createInitialSymptomPromptSession();
  }
  return sanitizeStoredState(raw);
}

/**
 * Persists traversal state for an episode (in-memory only).
 *
 * @param episodeId - `episodes.id`.
 * @param state - Next {@link SymptomPromptSessionState}.
 */
export function setSymptomPromptSession(
  episodeId: string,
  state: SymptomPromptSessionState,
): void {
  sessions.set(episodeId, state);
}

/**
 * Clears stored state when the user finishes or abandons a flow (optional hygiene).
 *
 * @param episodeId - `episodes.id`.
 */
export function clearSymptomPromptSession(episodeId: string): void {
  sessions.delete(episodeId);
}
