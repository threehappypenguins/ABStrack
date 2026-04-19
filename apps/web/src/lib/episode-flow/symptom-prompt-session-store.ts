import type {
  SymptomPromptAnswer,
  SymptomPromptAnswers,
  SymptomPromptSessionState,
} from '@abstrack/types';
import { createInitialSymptomPromptSession } from '@abstrack/types';

const STORAGE_PREFIX = 'abstrack.symptomPrompt.';

function storageKey(episodeId: string): string {
  return `${STORAGE_PREFIX}${episodeId}`;
}

/**
 * Produces a safe non-negative step index from stored JSON (rejects non-finite numbers and non-numbers).
 * Examples include `Infinity` parsed from large exponent literals (e.g. `1e400`) and string values.
 *
 * @param value - Parsed `activeIndex` field.
 * @returns Integer ≥ 0, or `null` if unusable.
 */
function sanitizeActiveIndex(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Keeps only well-shaped {@link SymptomPromptAnswer} values so corrupted `sessionStorage` cannot crash the UI.
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
    const activeIndex = sanitizeActiveIndex(parsed.activeIndex);
    if (activeIndex === null) {
      return createInitialSymptomPromptSession();
    }
    return {
      activeIndex,
      answers: sanitizeAnswers(parsed.answers),
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
