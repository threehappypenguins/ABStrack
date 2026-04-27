import type {
  SymptomPromptAnswer,
  SymptomPromptAnswers,
  SymptomPromptSessionState,
} from '@abstrack/types';
import {
  createInitialSymptomPromptSession,
  sanitizeSymptomPromptActiveIndex,
  sanitizeSymptomPromptAnswers,
} from '@abstrack/types';

const STORAGE_PREFIX = 'abstrack.symptomPrompt.';
const runtimeVideoAnswersByEpisode = new Map<string, SymptomPromptAnswers>();

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

/** Keeps only non-null video entries for runtime-only remount resilience. */
function extractRuntimeVideoAnswers(
  state: SymptomPromptSessionState,
): SymptomPromptAnswers {
  const out = Object.create(null) as SymptomPromptAnswers;
  for (const [key, answer] of Object.entries(state.answers)) {
    if (answer.type === 'video' && answer.value !== null) {
      out[key] = answer as SymptomPromptAnswer;
    }
  }
  return out;
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
    const durable = stripNonDurableAnswers({
      activeIndex,
      answers: sanitizeSymptomPromptAnswers(parsed.answers),
    });
    const runtimeVideoAnswers = runtimeVideoAnswersByEpisode.get(episodeId);
    if (!runtimeVideoAnswers) {
      return durable;
    }
    return {
      activeIndex: durable.activeIndex,
      answers: { ...durable.answers, ...runtimeVideoAnswers },
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
  runtimeVideoAnswersByEpisode.set(
    episodeId,
    extractRuntimeVideoAnswers(state),
  );
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
  runtimeVideoAnswersByEpisode.delete(episodeId);
  try {
    sessionStorage.removeItem(storageKey(episodeId));
  } catch {
    // ignore
  }
}
