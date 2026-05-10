/**
 * Patient caretaker invite/revoke: calls the **Supabase Edge Function**
 * `patient-caretaker-access` on the same project as `EXPO_PUBLIC_SUPABASE_URL`, so mobile does not
 * depend on a separate Next.js host. The function runs with an elevated Supabase server client
 * (default secret key) and validates the caller’s Bearer JWT.
 *
 * @see supabase/functions/patient-caretaker-access/index.ts
 */

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * Resolves the HTTP URL for caretaker grant GET/POST/DELETE (Supabase Edge Function).
 *
 * @returns URL string, or null when `EXPO_PUBLIC_SUPABASE_URL` is unset.
 */
export function resolvePatientCaretakerAccessUrl(): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!base) {
    return null;
  }
  return `${trimTrailingSlash(base)}/functions/v1/patient-caretaker-access`;
}

function publishableOrAnonKey(): string | null {
  const pub = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (pub) {
    return pub;
  }
  return process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? null;
}

function caretakerBearerHeaders(accessToken: string): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
  };
  const apikey = publishableOrAnonKey();
  if (apikey) {
    headers.apikey = apikey;
  }
  return headers;
}

function caretakerPostHeaders(accessToken: string): Record<string, string> {
  return {
    ...caretakerBearerHeaders(accessToken),
    'Content-Type': 'application/json',
  };
}

/**
 * Calls **GET** on the caretaker grant Edge Function.
 *
 * @param accessToken - Supabase session access token (JWT).
 */
export async function fetchCaretakerAccessGet(accessToken: string) {
  const url = resolvePatientCaretakerAccessUrl();
  if (!url) {
    throw new Error('missing_supabase_url_for_caretaker_api');
  }
  return fetch(url, {
    headers: caretakerBearerHeaders(accessToken),
  });
}

/**
 * Calls **POST** with an arbitrary JSON body (patient or caretaker flows).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param body - Payload (`caretakerEmail`, `cancelPendingCaretakerInvite`, `finalizeCaretakerInvite`, …).
 */
export async function fetchCaretakerAccessPostJson(
  accessToken: string,
  body: Record<string, unknown>,
) {
  const url = resolvePatientCaretakerAccessUrl();
  if (!url) {
    throw new Error('missing_supabase_url_for_caretaker_api');
  }
  return fetch(url, {
    method: 'POST',
    headers: caretakerPostHeaders(accessToken),
    body: JSON.stringify(body),
  });
}

/**
 * Calls **POST** with JSON `{ caretakerEmail }` (invite, link, or resend).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param caretakerEmail - Email for the caretaker’s ABStrack account.
 */
export async function fetchCaretakerAccessPost(
  accessToken: string,
  caretakerEmail: string,
) {
  return fetchCaretakerAccessPostJson(accessToken, { caretakerEmail });
}

/**
 * Calls **POST** `{ cancelPendingCaretakerInvite: true }` (patient session).
 *
 * @param accessToken - Supabase session access token (JWT).
 */
export async function fetchCaretakerAccessCancelPendingInvite(
  accessToken: string,
) {
  return fetchCaretakerAccessPostJson(accessToken, {
    cancelPendingCaretakerInvite: true,
  });
}

/**
 * Calls **POST** `{ finalizeCaretakerInvite: true, inviteId }` (caretaker session after invite email).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param inviteId - `caretaker_invites.id` from `user_metadata.abstrack_caretaker_invite_id`.
 */
export async function fetchCaretakerAccessFinalize(
  accessToken: string,
  inviteId: string,
) {
  return fetchCaretakerAccessPostJson(accessToken, {
    finalizeCaretakerInvite: true,
    inviteId,
  });
}

/**
 * Calls **DELETE** to revoke the active caretaker grant.
 *
 * @param accessToken - Supabase session access token (JWT).
 */
export async function fetchCaretakerAccessDelete(accessToken: string) {
  const url = resolvePatientCaretakerAccessUrl();
  if (!url) {
    throw new Error('missing_supabase_url_for_caretaker_api');
  }
  return fetch(url, {
    method: 'DELETE',
    headers: caretakerBearerHeaders(accessToken),
  });
}
