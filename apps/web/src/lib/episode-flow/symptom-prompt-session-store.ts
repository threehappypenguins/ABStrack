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
 * Blob URLs are document-scoped and not durable across reload/navigation.
 * Keep video answers in runtime state only; omit them from `sessionStorage`.
 */
function stripNonDurableAnswers(
  state: SymptomPromptSessionState,
): SymptomPromptSessionState {
  const answers = Object.fromEntries(
    Object.entries(state.answers).filter(
      ([, answer]) => answer.type !== 'video',
    ),
  );
  return {
    activeIndex: state.activeIndex,
    answers,
  };
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
    return stripNonDurableAnswers({
      activeIndex,
      answers: sanitizeSymptomPromptAnswers(parsed.answers),
    });
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
    sessionStorage.setItem(
      storageKey(episodeId),
      JSON.stringify(stripNonDurableAnswers(state)),
    );
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
