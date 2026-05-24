/**
 * Pure helpers for TOTP/MFA verification UX — extracted for unit testing (Supabase error shapes vary).
 */

export function normalizeTotpCode(raw: string): string {
  return raw.replace(/\D/g, '').slice(0, 6);
}

/**
 * Detects pasted Key URIs or setup blobs — not a six-digit OTP. We refuse these so
 * {@link normalizeTotpCode} cannot pull arbitrary digits out of an `otpauth://` string.
 *
 * @param raw - Field value (may include a full paste).
 * @returns Whether this looks like a setup payload rather than digits-only entry.
 */
export function looksLikeTotpSetupPayload(raw: string): boolean {
  return (
    /otpauth/i.test(raw) ||
    /:\/\/[^\s]*totp/i.test(raw) ||
    /\bsecret=/i.test(raw) ||
    /\bissuer=/i.test(raw)
  );
}

function getVerificationMessage(message?: string): string {
  const lower = message?.toLowerCase() ?? '';
  if (lower.includes('expired')) {
    return 'That code expired. Enter the latest code from your authenticator app and try again.';
  }
  if (lower.includes('invalid')) {
    return 'That code was not valid. Check the six-digit code and your device time, then try again.';
  }
  const trimmed = message?.trim();
  if (trimmed) {
    return trimmed;
  }
  return 'We could not verify that code yet. Please try again with a fresh code.';
}

type AuthLikeErrorFields = {
  message: string;
  status?: number;
  code?: string;
};

function readAuthLikeError(error: unknown): AuthLikeErrorFields {
  if (typeof error === 'string') {
    return { message: error };
  }
  if (typeof error !== 'object' || error === null) {
    return { message: '' };
  }
  const o = error as Record<string, unknown>;
  const message =
    typeof o.message === 'string'
      ? o.message
      : typeof o.msg === 'string'
        ? o.msg
        : '';
  const status = typeof o.status === 'number' ? o.status : undefined;
  const code = typeof o.code === 'string' ? o.code : undefined;
  if (!message && error instanceof Error) {
    return { message: error.message, status, code };
  }
  return { message, status, code };
}

/**
 * Maps MFA verify (and related) failures to accessible copy.
 *
 * @param error - Caught error from `mfa.challenge` / `mfa.verify`.
 * @returns User-visible message.
 */
export function mapMfaVerifyErrorToUserMessage(error: unknown): string {
  const { message: raw, status, code } = readAuthLikeError(error);
  const lower = raw.toLowerCase();

  if (status === 401) {
    return 'Your session may have expired. Sign in again, then retry verification.';
  }

  if (status === 422 || status === 400) {
    return 'That code did not match. Enter the current six-digit code from your authenticator.';
  }

  if (
    lower.includes('invalid') ||
    lower.includes('incorrect') ||
    lower.includes('mismatch') ||
    lower.includes('wrong') ||
    lower.includes('verification failed')
  ) {
    return getVerificationMessage(raw);
  }

  if (lower.includes('expired') || lower.includes('challenge')) {
    return getVerificationMessage(raw);
  }

  if (code === 'mfa_verification_failed' || code === 'mfa_challenge_expired') {
    return getVerificationMessage(raw);
  }

  if (raw.trim()) {
    return getVerificationMessage(raw);
  }

  return 'That code did not match. Enter the current six-digit code from your authenticator.';
}

/**
 * DELETE `/factors/:id` may 404 if the factor was already removed — treat as success so Cancel
 * stays idempotent.
 *
 * @param error - Result from `mfa.unenroll` or thrown value.
 * @returns Whether local enrollment UI can be cleared without surfacing an error.
 */
export function isUnenrollAlreadyGoneError(error: unknown): boolean {
  const { message, status } = readAuthLikeError(error);
  if (status === 404 || status === 410) {
    return true;
  }
  const lower = message.toLowerCase();
  return (
    lower.includes('not found') ||
    lower.includes('no rows') ||
    lower.includes('already been deleted')
  );
}

/**
 * User-visible copy when `mfa.unenroll` fails for reasons other than an already-removed factor.
 *
 * @param error - Error from `mfa.unenroll`.
 * @returns Message for announcements.
 */
export function mapMfaUnenrollErrorToUserMessage(error: unknown): string {
  const { status } = readAuthLikeError(error);
  if (status === 401) {
    return 'Your session may have expired. Sign in again, then try canceling enrollment.';
  }
  return 'Could not cancel enrollment on the server. Check your connection and try again.';
}
