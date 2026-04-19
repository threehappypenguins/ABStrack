import type { SymptomPromptSessionState } from '@abstrack/types';
import {
  createInitialSymptomPromptSession,
  sanitizeSymptomPromptActiveIndex,
  sanitizeSymptomPromptAnswers,
} from '@abstrack/types';

const STORAGE_PREFIX = 'abstrack.symptomPrompt.';

function storageKey(episodeId: string): string {
  return `${STORAGE_PREFIX}${episodeId}`;
}

/**
 * Reads traversal state from `sessionStorage` for the current browser session.
 *
 * @param episodeId - `episodes.id`.
 * @returns Parsed state or {@link createInitialSymptomPromptSession}.
 */
export function getSymptomPromptSession(
  episodeId: string,
): SymptomPromptSessionState {
  if (typeof window === 'undefined') {
    return createInitialSymptomPromptSession();
  }
  try {
    const raw = sessionStorage.getItem(storageKey(episodeId));
    if (!raw) {
      return createInitialSymptomPromptSession();
    }
    const parsed = JSON.parse(raw) as SymptomPromptSessionState;
    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof parsed.answers !== 'object' ||
      parsed.answers === null ||
      Array.isArray(parsed.answers)
    ) {
      return createInitialSymptomPromptSession();
    }
    const activeIndex = sanitizeSymptomPromptActiveIndex(parsed.activeIndex);
    if (activeIndex === null) {
      return createInitialSymptomPromptSession();
    }
    return {
      activeIndex,
      answers: sanitizeSymptomPromptAnswers(parsed.answers),
    };
  } catch {
    return createInitialSymptomPromptSession();
  }
}

/**
 * Persists traversal state for an episode in `sessionStorage`.
 *
 * @param episodeId - `episodes.id`.
 * @param state - Next {@link SymptomPromptSessionState}.
 */
export function setSymptomPromptSession(
  episodeId: string,
  state: SymptomPromptSessionState,
): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    sessionStorage.setItem(storageKey(episodeId), JSON.stringify(state));
  } catch {
    // Quota or private mode — ignore; in-flow state still works for the current mount.
  }
}

/**
 * Removes stored state for an episode (e.g. after finishing the skeleton flow).
 *
 * @param episodeId - `episodes.id`.
 */
export function clearSymptomPromptSession(episodeId: string): void {
  if (typeof window === 'undefined') {
    return;
  }
  try {
    sessionStorage.removeItem(storageKey(episodeId));
  } catch {
    // ignore
  }
}
