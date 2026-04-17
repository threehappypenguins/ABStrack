/**
 * Failure payload when a logout `POST` fails same-origin / anti-CSRF checks.
 */
export type SameOriginLogoutPostFailure = {
  status: 400 | 403;
  error: string;
};

/**
 * Blocks cross-site `POST` requests to the practitioner logout endpoint so a malicious page cannot
 * forge a form that signs users out (CSRF). Checks enforce **same-origin** (exact URL origin), not
 * schemeful same-site: prefer a non-empty matching `Origin`, else a matching `Referer` origin; if both
 * are absent, only `Sec-Fetch-Site: same-origin` is accepted (`same-site` is rejected so the guard
 * matches its name and stays predictable when browsers omit `Origin` on some `POST`s).
 *
 * This is not a substitute for CSRF tokens when you must support trusted cross-origin clients;
 * practitioner logout is intended to be same-origin only.
 *
 * @param request - Minimal request shape (`url` + `headers`), e.g. Next.js `NextRequest`.
 * @returns `null` if the request may proceed, or a failure object the route should turn into a 4xx response.
 */
export function getSameOriginLogoutPostFailure(
  request: Pick<Request, 'url' | 'headers'>,
): SameOriginLogoutPostFailure | null {
  const expectedOrigin = new URL(request.url).origin;

  const origin = request.headers.get('Origin');
  if (origin !== null && origin !== '') {
    if (origin !== expectedOrigin) {
      return { status: 403, error: 'Invalid Origin' };
    }
    return null;
  }

  if (request.headers.get('Sec-Fetch-Site') === 'cross-site') {
    return { status: 403, error: 'Cross-site request rejected' };
  }

  const referer = request.headers.get('Referer');
  if (referer) {
    try {
      if (new URL(referer).origin !== expectedOrigin) {
        return { status: 403, error: 'Invalid Referer' };
      }
      return null;
    } catch {
      return { status: 400, error: 'Invalid Referer' };
    }
  }

  const secFetchSite = request.headers.get('Sec-Fetch-Site');
  if (secFetchSite === 'same-origin') {
    return null;
  }

  return { status: 403, error: 'Could not validate request origin' };
}
