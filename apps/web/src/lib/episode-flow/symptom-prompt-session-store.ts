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
const runtimeMediaAnswersByEpisode = new Map<string, SymptomPromptAnswers>();

function storageKey(episodeId: string): string {
  return `${STORAGE_PREFIX}${episodeId}`;
}

/**
 * Blob URLs are document-scoped and not durable across reload/navigation.
 * Keep only non-durable media answers in runtime state; omit them from `sessionStorage`.
 */
function photoRefIsNonDurable(localUri: string): boolean {
  return localUri.startsWith('blob:');
}

function answerIsNonDurable(answer: SymptomPromptAnswer): boolean {
  if (answer.type === 'video') {
    return true;
  }
  if (answer.type === 'photo' && answer.value !== null) {
    return photoRefIsNonDurable(answer.value.localUri);
  }
  return false;
}

function stripNonDurableAnswers(
  state: SymptomPromptSessionState,
): SymptomPromptSessionState {
  const answers = Object.fromEntries(
    Object.entries(state.answers).filter(
      ([, answer]) => !answerIsNonDurable(answer),
    ),
  );
  return {
    activeIndex: state.activeIndex,
    answers,
  };
}

/** Keeps only non-null media entries for runtime-only remount resilience. */
function extractRuntimeMediaAnswers(
  state: SymptomPromptSessionState,
): SymptomPromptAnswers {
  const out = Object.create(null) as SymptomPromptAnswers;
  for (const [key, answer] of Object.entries(state.answers)) {
    if (answer.type === 'video' && answer.value !== null) {
      out[key] = answer as SymptomPromptAnswer;
      continue;
    }
    if (
      answer.type === 'photo' &&
      answer.value !== null &&
      photoRefIsNonDurable(answer.value.localUri)
    ) {
      out[key] = answer as SymptomPromptAnswer;
    }
  }
  return out;
}

function revokeBlobUris(answers: SymptomPromptAnswers): void {
  for (const answer of Object.values(answers)) {
    if (answer.type === 'video' && answer.value !== null) {
      URL.revokeObjectURL(answer.value.localUri);
      continue;
    }
    if (
      answer.type === 'photo' &&
      answer.value !== null &&
      photoRefIsNonDurable(answer.value.localUri)
    ) {
      URL.revokeObjectURL(answer.value.localUri);
    }
  }
}

function runtimeMediaBlobUris(answers: SymptomPromptAnswers): Set<string> {
  const out = new Set<string>();
  for (const answer of Object.values(answers)) {
    if (answer.type === 'video' && answer.value !== null) {
      out.add(answer.value.localUri);
      continue;
    }
    if (
      answer.type === 'photo' &&
      answer.value !== null &&
      photoRefIsNonDurable(answer.value.localUri)
    ) {
      out.add(answer.value.localUri);
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
    const runtimeMediaAnswers = runtimeMediaAnswersByEpisode.get(episodeId);
    if (!runtimeMediaAnswers) {
      return durable;
    }
    return {
      activeIndex: durable.activeIndex,
      answers: { ...durable.answers, ...runtimeMediaAnswers },
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
  const runtimeMediaAnswers = extractRuntimeMediaAnswers(state);
  const previousRuntimeMedia = runtimeMediaAnswersByEpisode.get(episodeId);
  if (previousRuntimeMedia) {
    const previousUris = runtimeMediaBlobUris(previousRuntimeMedia);
    const nextUris = runtimeMediaBlobUris(runtimeMediaAnswers);
    for (const uri of previousUris) {
      if (!nextUris.has(uri)) {
        URL.revokeObjectURL(uri);
      }
    }
  }
  if (Object.keys(runtimeMediaAnswers).length === 0) {
    runtimeMediaAnswersByEpisode.delete(episodeId);
  } else {
    runtimeMediaAnswersByEpisode.set(episodeId, runtimeMediaAnswers);
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
  const runtimeMediaAnswers = runtimeMediaAnswersByEpisode.get(episodeId);
  if (runtimeMediaAnswers) {
    revokeBlobUris(runtimeMediaAnswers);
  }
  runtimeMediaAnswersByEpisode.delete(episodeId);
  try {
    sessionStorage.removeItem(storageKey(episodeId));
  } catch {
    // ignore
  }
}
