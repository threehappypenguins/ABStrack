/**
 * Detects caretaker **email invite** URLs so the native app can finish auth + Edge finalize.
 * Supports Expo `scheme` deep links (`abstrack:///caretaker-invite`) and **HTTPS App Links /
 * Universal Links** to user web **`/auth/callback?…&next=/caretaker/join`** (invite `code` is only
 * on that URL; **`/caretaker/join`** after web exchange has no `code`, so it is not an App Link target).
 */

/**
 * @param raw - Same origin you use for user web (e.g. `https://app.example.com`); optional `EXPO_PUBLIC_USER_WEB_ORIGIN`.
 * @returns Normalized `URL.origin`, or `null` when unset or invalid.
 */
export function normalizeUserWebOrigin(raw: string | undefined): string | null {
  if (raw == null) {
    return null;
  }
  const t = raw.trim();
  if (t === '') {
    return null;
  }
  try {
    const withScheme = /^https?:\/\//i.test(t) ? t : `https://${t}`;
    return new URL(withScheme).origin;
  } catch {
    return null;
  }
}

function parseUrlParts(url: string): {
  origin: string;
  pathname: string;
  params: URLSearchParams;
} | null {
  try {
    const parsed = new URL(url);
    const params = new URLSearchParams(parsed.search);
    const hashParams = new URLSearchParams(parsed.hash.replace(/^#/, ''));
    hashParams.forEach((value, key) => {
      params.set(key, value);
    });
    const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
    return { origin: parsed.origin, pathname, params };
  } catch {
    return null;
  }
}

function nextTargetsCaretakerJoin(params: URLSearchParams): boolean {
  const next = params.get('next');
  if (next == null || next === '') {
    return false;
  }
  let decoded = next;
  try {
    decoded = decodeURIComponent(next);
  } catch {
    /* use raw */
  }
  return decoded.startsWith('/caretaker/join');
}

/**
 * `abstrack:///caretaker-invite?…` (matches Expo `scheme` + Edge `ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`).
 */
export function isAbstrackCaretakerInviteUrl(url: string): boolean {
  if (!url.startsWith('abstrack:')) {
    return false;
  }
  const parts = parseUrlParts(url);
  if (!parts) {
    return false;
  }
  const { pathname } = parts;
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return '';
    }
  })();
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  return normalizedPath === '/caretaker-invite' || host === 'caretaker-invite';
}

/**
 * HTTPS user-web invite completion (matches Edge `ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN` + Auth callback).
 *
 * @param url - Initial or foreground deep link URL.
 * @param userWebOriginEnv - `EXPO_PUBLIC_USER_WEB_ORIGIN` at bundle time.
 */
export function isHttpsCaretakerInviteUrl(
  url: string,
  userWebOriginEnv: string | undefined,
): boolean {
  const allowed = normalizeUserWebOrigin(userWebOriginEnv);
  if (!allowed) {
    return false;
  }
  const parts = parseUrlParts(url);
  if (!parts) {
    return false;
  }
  if (parts.origin !== allowed) {
    return false;
  }
  if (parts.pathname === '/auth/callback') {
    return (
      Boolean(parts.params.get('code')) &&
      nextTargetsCaretakerJoin(parts.params)
    );
  }
  return false;
}

/**
 * User web **`/caretaker/join`** after server-side exchange has **no** `code`. If the OS still
 * delivers that URL to the app (stale association data, manual open), callers should show UX
 * instead of ignoring the URL.
 *
 * @param url - Deep link from `Linking`.
 * @param userWebOriginEnv - `EXPO_PUBLIC_USER_WEB_ORIGIN` at bundle time.
 */
export function isHttpsCaretakerJoinWithoutCodeUrl(
  url: string,
  userWebOriginEnv: string | undefined,
): boolean {
  const allowed = normalizeUserWebOrigin(userWebOriginEnv);
  if (!allowed) {
    return false;
  }
  const parts = parseUrlParts(url);
  if (!parts || parts.origin !== allowed) {
    return false;
  }
  const path = parts.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/caretaker/join' && !path.startsWith('/caretaker/join/')) {
    return false;
  }
  return !parts.params.get('code');
}

/**
 * @param url - Deep link from `Linking`.
 * @param userWebOriginEnv - `EXPO_PUBLIC_USER_WEB_ORIGIN` (same user-web origin as invite `redirectTo`).
 */
export function isCaretakerInviteLinkUrl(
  url: string,
  userWebOriginEnv: string | undefined,
): boolean {
  return (
    isAbstrackCaretakerInviteUrl(url) ||
    isHttpsCaretakerInviteUrl(url, userWebOriginEnv)
  );
}
