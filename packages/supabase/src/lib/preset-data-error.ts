/**
 * User-oriented errors for preset CRUD / reorder helpers (shared by web and mobile).
 */

/** Stable machine-readable reason for {@link PresetDataError}. */
export type PresetDataErrorCode =
  | 'not_found'
  | 'validation_error'
  | 'permission_denied'
  | 'conflict'
  | 'foreign_key_violation'
  | 'network_error'
  | 'unknown';

/**
 * Error returned by preset data helpers when the result is `{ ok: false }`.
 * {@link PresetDataError.message} is safe to show in UI copy.
 */
export class PresetDataError extends Error {
  readonly code: PresetDataErrorCode;

  /**
   * @param code - Machine-readable category.
   * @param message - User-facing explanation.
   * @param cause - Original Supabase / network error when available.
   */
  constructor(code: PresetDataErrorCode, message: string, cause?: unknown) {
    super(message);
    this.name = 'PresetDataError';
    this.code = code;
    if (cause !== undefined) {
      (this as Error & { cause?: unknown }).cause = cause;
    }
  }
}

type MaybePostgrestLike = {
  code?: string;
  message?: string;
  details?: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** RN fetch often uses `Error`, not `TypeError`; Supabase-js may use plain `{ message }`. */
function messageLooksLikeFetchTransportFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror when attempting') ||
    m.includes('load failed') ||
    m.includes('network request failed')
  );
}

/**
 * Detects browser/React-Native fetch failures that are not PostgREST-shaped.
 * (e.g. `TypeError: Failed to fetch` has no `code` field.)
 */
function isLikelyNetworkTransportError(error: unknown): boolean {
  if (typeof error !== 'object' || error === null) {
    return false;
  }
  if ('name' in error) {
    const name = (error as { name?: string }).name;
    if (name === 'AbortError') {
      return true;
    }
    if (typeof name === 'string' && name.includes('Network')) {
      return true;
    }
  }
  if (
    error instanceof Error &&
    messageLooksLikeFetchTransportFailure(error.message)
  ) {
    return true;
  }
  if (
    isRecord(error) &&
    typeof error.message === 'string' &&
    messageLooksLikeFetchTransportFailure(error.message)
  ) {
    return true;
  }
  return false;
}

function asPostgrestLike(error: unknown): MaybePostgrestLike | null {
  if (error instanceof Error) {
    const e = error as Error & { code?: string; details?: unknown };
    if (typeof e.code !== 'string') {
      return null;
    }
    return {
      code: e.code,
      message: e.message,
      details: typeof e.details === 'string' ? e.details : null,
    };
  }
  if (!isRecord(error)) {
    return null;
  }
  const code = error.code;
  const message = error.message;
  if (typeof message !== 'string') {
    return null;
  }
  return {
    code: typeof code === 'string' ? code : undefined,
    message,
    details: typeof error.details === 'string' ? error.details : null,
  };
}

/**
 * Maps a Supabase PostgREST / Postgres error (or similar) to {@link PresetDataError}.
 *
 * @param error - Value from `PostgrestError` or thrown network failures.
 * @returns A {@link PresetDataError}, or `null` when `error` is not recognized.
 */
export function mapSupabaseErrorToPresetDataError(
  error: unknown,
): PresetDataError | null {
  if (isLikelyNetworkTransportError(error)) {
    return new PresetDataError(
      'network_error',
      'Could not reach the server. Check your connection and try again.',
      error,
    );
  }

  const pg = asPostgrestLike(error);
  if (!pg) {
    return null;
  }

  const combined = `${pg.message} ${pg.details ?? ''}`;

  if (
    combined.includes('abstrack_preset_reorder_count_mismatch') ||
    combined.includes('abstrack_preset_reorder_duplicate_id') ||
    combined.includes('abstrack_preset_reorder_unknown_line') ||
    combined.includes('abstrack_preset_reorder_update_count_mismatch')
  ) {
    return new PresetDataError(
      'validation_error',
      'That reorder is out of date or invalid. Refresh the list and try again.',
      error,
    );
  }

  if (pg.code === 'PGRST116') {
    return new PresetDataError(
      'not_found',
      'We could not find that item. It may have been removed.',
      error,
    );
  }

  if (pg.code === '23505') {
    return new PresetDataError(
      'conflict',
      'That change conflicts with existing data. Try again after refreshing.',
      error,
    );
  }

  if (pg.code === '23503') {
    if (combined.includes('health_markers_preset_health_marker_id_fkey')) {
      return new PresetDataError(
        'foreign_key_violation',
        'Cannot delete this marker line: saved episode measurements still reference it. Keep the line, or change the preset only before it is used in an episode.',
        error,
      );
    }
    return new PresetDataError(
      'foreign_key_violation',
      'That item is still linked to something else. Remove the link or pick a different value.',
      error,
    );
  }

  const lowerMsg = (pg.message ?? '').toLowerCase();
  if (
    pg.code === '42501' ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('row-level security')
  ) {
    return new PresetDataError(
      'permission_denied',
      'You do not have permission to do that.',
      error,
    );
  }

  if (pg.code === 'PGRST301' || pg.code === '401') {
    return new PresetDataError(
      'permission_denied',
      'Your session may have expired. Sign in again and retry.',
      error,
    );
  }

  return new PresetDataError(
    'unknown',
    'Something went wrong. Please try again.',
    error,
  );
}

/**
 * Wraps any unknown failure as {@link PresetDataError}, using {@link mapSupabaseErrorToPresetDataError}
 * when possible.
 *
 * Idempotent: an existing {@link PresetDataError} is returned unchanged so callers may safely wrap
 * any caught value without losing `code`, message, or `cause`.
 *
 * @param error - Caught rejection or Supabase `error` object.
 */
export function toPresetDataError(error: unknown): PresetDataError {
  if (error instanceof PresetDataError) {
    return error;
  }
  return (
    mapSupabaseErrorToPresetDataError(error) ??
    new PresetDataError(
      'unknown',
      error instanceof Error
        ? error.message || 'Something went wrong. Please try again.'
        : 'Something went wrong. Please try again.',
      error,
    )
  );
}
