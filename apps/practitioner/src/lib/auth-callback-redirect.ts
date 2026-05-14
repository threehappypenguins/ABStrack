const DEFAULT_REDIRECT_PATH = '/';

/**
 * User-facing message when an email auth link cannot be completed (expired, reused, or malformed).
 */
export const AUTH_CALLBACK_INVALID_LINK_MESSAGE =
  'This sign-in link is invalid or expired. Request a new one.';

/**
 * Returns a same-origin relative path for post-auth redirect on the practitioner app, or the
 * default when `next` is unsafe.
 *
 * @param nextParam - Optional `next` query value from `/auth/callback`.
 * @returns Path beginning with `/` suitable for `NextResponse.redirect`.
 */
export function getSafePractitionerAuthCallbackRedirectPath(
  nextParam: string | null,
): string {
  if (!nextParam || !nextParam.startsWith('/') || nextParam.startsWith('//')) {
    return DEFAULT_REDIRECT_PATH;
  }

  try {
    const parseBase = 'https://example.com';
    const parsed = new URL(nextParam, parseBase);
    if (parsed.origin !== parseBase) {
      return DEFAULT_REDIRECT_PATH;
    }

    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return DEFAULT_REDIRECT_PATH;
  }
}
