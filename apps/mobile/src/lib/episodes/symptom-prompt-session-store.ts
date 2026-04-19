import type { SymptomPromptSessionState, Uuid } from '@abstrack/types';
import {
  createInitialSymptomPromptSession,
  sanitizeSymptomPromptActiveIndex,
  sanitizeSymptomPromptAnswers,
} from '@abstrack/types';

/**
 * In-memory session store so symptom prompt progress survives leaving and re-opening the
 * prompt screen during one app session (same episode id).
 */
const sessions = new Map<Uuid, SymptomPromptSessionState>();

function sanitizeStoredState(raw: unknown): SymptomPromptSessionState {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return createInitialSymptomPromptSession();
  }
  const o = raw as Record<string, unknown>;
  const answers = o['answers'];
  if (
    typeof answers !== 'object' ||
    answers === null ||
    Array.isArray(answers)
  ) {
    return createInitialSymptomPromptSession();
  }
  const activeIndex = sanitizeSymptomPromptActiveIndex(o['activeIndex']);
  if (activeIndex === null) {
    return createInitialSymptomPromptSession();
  }
  return { activeIndex, answers: sanitizeSymptomPromptAnswers(answers) };
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
