import {
  SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS,
  type SymptomPromptAnswer,
  type SymptomPromptAnswers,
} from './symptom-prompt-session.js';

/** Matches severity UI (1–5 scale); integers only. */
const SEVERITY_MIN = 1;
const SEVERITY_MAX = 5;
/**
 * Produces a safe non-negative step index from untrusted JSON (rejects non-finite numbers and non-numbers).
 *
 * @param value - Parsed `activeIndex` field.
 * @returns Integer ≥ 0, or `null` if unusable.
 */
export function sanitizeSymptomPromptActiveIndex(
  value: unknown,
): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return null;
  }
  return Math.max(0, Math.floor(value));
}

/**
 * Returns a single well-shaped {@link SymptomPromptAnswer} or `null` if the value cannot be represented safely.
 *
 * @param value - One entry from a parsed `answers` map.
 * @returns A valid answer, or `null` to drop the entry.
 */
export function sanitizeSymptomPromptAnswerEntry(
  value: unknown,
): SymptomPromptAnswer | null {
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
    case 'severity_scale': {
      if (v === null) {
        return { type: 'severity_scale', value: null };
      }
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        return null;
      }
      if (Number.isInteger(v) && v >= SEVERITY_MIN && v <= SEVERITY_MAX) {
        return { type: 'severity_scale', value: v };
      }
      return { type: 'severity_scale', value: null };
    }
    case 'free_text':
      if (typeof v === 'string') {
        return { type: 'free_text', value: v };
      }
      return null;
    case 'photo': {
      if (v === null) {
        return { type: 'photo', value: null };
      }
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return null;
      }
      const photoRef = v as Record<string, unknown>;
      if (typeof photoRef.localUri !== 'string') {
        return null;
      }
      const localUri = photoRef.localUri.trim();
      if (localUri.length === 0) {
        return null;
      }
      if (typeof photoRef.capturedAt !== 'string') {
        return null;
      }
      const capturedAt = photoRef.capturedAt.trim();
      if (capturedAt.length === 0 || !Number.isFinite(Date.parse(capturedAt))) {
        return null;
      }
      const thumbRaw = photoRef.thumbnailStorageUri;
      let thumbnailStorageUri: string | undefined;
      if (thumbRaw !== undefined && thumbRaw !== null) {
        if (typeof thumbRaw !== 'string') {
          return null;
        }
        const t = thumbRaw.trim();
        if (t.length > 0) {
          thumbnailStorageUri = t;
        }
      }
      return {
        type: 'photo',
        value: {
          localUri,
          capturedAt,
          ...(thumbnailStorageUri !== undefined ? { thumbnailStorageUri } : {}),
        },
      };
    }
    case 'video': {
      if (v === null) {
        return { type: 'video', value: null };
      }
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return null;
      }
      const videoRef = v as Record<string, unknown>;
      let durationMs: number | null;
      if (videoRef.durationMs === undefined || videoRef.durationMs === null) {
        durationMs = null;
      } else if (
        typeof videoRef.durationMs === 'number' &&
        Number.isFinite(videoRef.durationMs) &&
        videoRef.durationMs >= 0 &&
        videoRef.durationMs <= SYMPTOM_PROMPT_VIDEO_MAX_DURATION_MS
      ) {
        durationMs = videoRef.durationMs;
      } else {
        return null;
      }
      if (typeof videoRef.localUri !== 'string') {
        return null;
      }
      const localUri = videoRef.localUri.trim();
      if (localUri.length === 0) {
        return null;
      }
      if (typeof videoRef.capturedAt !== 'string') {
        return null;
      }
      const capturedAt = videoRef.capturedAt.trim();
      if (capturedAt.length === 0 || !Number.isFinite(Date.parse(capturedAt))) {
        return null;
      }
      const thumbRaw = videoRef.thumbnailStorageUri;
      let thumbnailStorageUri: string | undefined;
      if (thumbRaw !== undefined && thumbRaw !== null) {
        if (typeof thumbRaw !== 'string') {
          return null;
        }
        const t = thumbRaw.trim();
        if (t.length > 0) {
          thumbnailStorageUri = t;
        }
      }
      return {
        type: 'video',
        value: {
          localUri,
          durationMs,
          capturedAt,
          ...(thumbnailStorageUri !== undefined ? { thumbnailStorageUri } : {}),
        },
      };
    }
    default:
      return null;
  }
}

/** Rejects keys that must not be assigned when copying untrusted data into an object. */
function isSafeSymptomPromptAnswerKey(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/**
 * Builds a safe `answers` map from untrusted JSON (drops bad entries; uses a null-prototype object).
 *
 * @param answers - Parsed `answers` object.
 * @returns Sanitized answers; may be empty.
 */
export function sanitizeSymptomPromptAnswers(
  answers: unknown,
): SymptomPromptAnswers {
  if (
    typeof answers !== 'object' ||
    answers === null ||
    Array.isArray(answers)
  ) {
    return Object.create(null) as SymptomPromptAnswers;
  }
  const out = Object.create(null) as SymptomPromptAnswers;
  for (const [key, val] of Object.entries(answers)) {
    if (!isSafeSymptomPromptAnswerKey(key)) {
      continue;
    }
    const cleaned = sanitizeSymptomPromptAnswerEntry(val);
    if (cleaned !== null) {
      out[key] = cleaned;
    }
  }
  return out;
}
