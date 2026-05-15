/**
 * HTTP client for the **`patient-practitioner-access`** Supabase Edge Function (same project as
 * `EXPO_PUBLIC_SUPABASE_URL`). Validates Bearer JWT in the function; uses default secret key server-side.
 *
 * The Functions gateway requires an **`apikey`** header: **`EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY`**
 * (`sb_publishable_…`), via **`getSupabasePublishableKey`** from **`@abstrack/supabase`**.
 *
 * @see supabase/functions/patient-practitioner-access/index.ts
 */

import { getSupabasePublishableKey } from '@abstrack/supabase';

export const MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_PRACTITIONER_API =
  'missing_supabase_publishable_key_for_practitioner_api';

export const PRACTITIONER_EDGE_PUBLISHABLE_KEY_ENV_HELP =
  'Set EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/mobile/.env (publishable key from Supabase → Settings → API Keys). The Edge gateway requires the apikey header on every request.';

/**
 * @param error - Caught rejection from practitioner Edge fetch helpers.
 * @returns True when publishable key is missing or invalid for client env.
 */
export function isMissingPublishableKeyForPractitionerEdge(
  error: unknown,
): boolean {
  if (!(error instanceof Error)) {
    return false;
  }
  if (error.message === MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_PRACTITIONER_API) {
    return true;
  }
  return error.message.startsWith('Invalid Supabase publishable key');
}

function trimTrailingSlash(url: string): string {
  return url.replace(/\/$/, '');
}

/**
 * @returns URL string for the practitioner-access Edge Function, or null when `EXPO_PUBLIC_SUPABASE_URL` is unset.
 */
export function resolvePatientPractitionerAccessUrl(): string | null {
  const base = process.env.EXPO_PUBLIC_SUPABASE_URL?.trim();
  if (!base) {
    return null;
  }
  return `${trimTrailingSlash(base)}/functions/v1/patient-practitioner-access`;
}

function requirePublishableKeyForFunctionsGateway(): string {
  try {
    return getSupabasePublishableKey();
  } catch (err) {
    if (
      err instanceof Error &&
      err.message.startsWith('Missing Supabase publishable key')
    ) {
      throw new Error(MISSING_SUPABASE_PUBLISHABLE_KEY_FOR_PRACTITIONER_API);
    }
    throw err;
  }
}

function practitionerBearerHeaders(
  accessToken: string,
): Record<string, string> {
  return {
    Authorization: `Bearer ${accessToken}`,
    apikey: requirePublishableKeyForFunctionsGateway(),
  };
}

function practitionerPostHeaders(accessToken: string): Record<string, string> {
  return {
    ...practitionerBearerHeaders(accessToken),
    'Content-Type': 'application/json',
  };
}

/**
 * GET active practitioner grants (patient session).
 *
 * @param accessToken - Supabase session access token (JWT).
 */
export async function fetchPractitionerAccessGet(accessToken: string) {
  const url = resolvePatientPractitionerAccessUrl();
  if (!url) {
    throw new Error('missing_supabase_url_for_practitioner_api');
  }
  return fetch(url, {
    headers: practitionerBearerHeaders(accessToken),
  });
}

/**
 * POST JSON to the practitioner Edge Function.
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param body - Invite, revoke, resend, cancel pending, or finalize payload.
 */
export async function fetchPractitionerAccessPostJson(
  accessToken: string,
  body: Record<string, unknown>,
) {
  const url = resolvePatientPractitionerAccessUrl();
  if (!url) {
    throw new Error('missing_supabase_url_for_practitioner_api');
  }
  return fetch(url, {
    method: 'POST',
    headers: practitionerPostHeaders(accessToken),
    body: JSON.stringify(body),
  });
}

/**
 * POST invite or link by practitioner email (patient session).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param practitionerEmail - Email for the practitioner account.
 */
export async function fetchPractitionerAccessPostInvite(
  accessToken: string,
  practitionerEmail: string,
) {
  return fetchPractitionerAccessPostJson(accessToken, { practitionerEmail });
}

/**
 * POST resend invite email when a **pending practitioner invite** matches that email, or an **active grant**
 * exists for that practitioner (patient session).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param practitionerEmail - Normalized practitioner email to resend to.
 */
export async function fetchPractitionerAccessResendInvite(
  accessToken: string,
  practitionerEmail: string,
) {
  return fetchPractitionerAccessPostJson(accessToken, {
    practitionerEmail,
    resendPractitionerInvite: true,
  });
}

/**
 * POST revoke practitioner access (patient session).
 *
 * @param accessToken - Supabase session access token (JWT).
 * @param practitionerUserId - Practitioner `auth.users` id to revoke.
 */
export async function fetchPractitionerAccessRevoke(
  accessToken: string,
  practitionerUserId: string,
) {
  return fetchPractitionerAccessPostJson(accessToken, {
    revokePractitionerUserId: practitionerUserId,
  });
}

/**
 * POST cancel a pending practitioner email invite (patient session).
 *
 * @param accessToken - Supabase session access token (JWT).
 */
export async function fetchPractitionerAccessCancelPendingInvite(
  accessToken: string,
) {
  return fetchPractitionerAccessPostJson(accessToken, {
    cancelPendingPractitionerInvite: true,
  });
}
