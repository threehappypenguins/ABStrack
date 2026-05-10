/**
 * Patient caretaker invite/revoke: calls the **Supabase Edge Function**
 * `patient-caretaker-access` on the same project as `EXPO_PUBLIC_SUPABASE_URL`, so mobile does not
 * depend on a separate Next.js host. The function runs with an elevated Supabase server client
 * (default secret key) and validates the caller’s Bearer JWT.
 *
 * The Functions gateway requires an **`apikey`** header: **`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**
 * (`sb_publishable_…`).
 *
 * @see supabase/functions/patient-caretaker-access/index.ts
 */

/** Thrown when `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is unset (Edge gateway needs `apikey`). */
export const MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_CARETAKER_API =
  'missing_supabase_publishable_key_for_caretaker_api';

/**
 * User-facing hint when `MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_CARETAKER_API` was thrown.
 */
export const CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP =
  'Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/mobile/.env (publishable key from Supabase → Settings → API Keys). The Edge gateway requires the apikey header on every request.';

/**
 * @param error - Caught rejection from caretaker Edge fetch helpers.
 * @returns True when `error` is the missing publishable key misconfiguration.
 */
export function isMissingPublishableKeyForCaretakerEdge(
  error: unknown,
): boolean {
  return (
    error instanceof Error &&
    error.message === MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_CARETAKER_API
  );
}

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

/**
 * Publishable key for Supabase Edge `apikey` (required by the gateway alongside the user JWT).
 *
 * @throws {Error} When unset; `message` is `MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_CARETAKER_API`.
 */
function requirePublishableKeyForFunctionsGateway(): string {
  const pub = process.env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!pub) {
    throw new Error(MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_CARETAKER_API);
  }
  return pub;
}

/**
 * Headers for caretaker Edge Function calls (Bearer session + `apikey`).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @throws When `EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY` is missing (misconfigured app env).
 */
function caretakerBearerHeaders(accessToken: string): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: requirePublishableKeyForFunctionsGateway(),
  };
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
 * @throws {Error} When URL or publishable key env is missing (see module constants).
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
 * @throws {Error} When URL or publishable key env is missing (see module constants).
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
 * @throws {Error} When URL or publishable key env is missing (see module constants).
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
