'use client';

import { getSupabasePublishableKey, getSupabaseUrl } from '@abstrack/supabase';
import { createBrowserClient } from '@/lib/supabase/browser-client';

/**
 * HTTPS URL for the `patient-practitioner-access` Edge Function (same contract as mobile).
 *
 * @throws Error when `NEXT_PUBLIC_SUPABASE_URL` is unset (build/runtime misconfiguration).
 */
export function patientPractitionerEdgeFunctionsUrl(): string {
  const base = getSupabaseUrl().replace(/\/$/, '');
  return `${base}/functions/v1/patient-practitioner-access`;
}

function bearerHeaders(
  accessToken: string,
  includeJsonContentType: boolean,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    apikey: getSupabasePublishableKey(),
  };
  if (includeJsonContentType) {
    headers['Content-Type'] = 'application/json';
  }
  return headers;
}

export const PATIENT_PRACTITIONER_ACCESS_ERROR_MISSING_TOKEN =
  'missing_access_token';

export const PATIENT_PRACTITIONER_ACCESS_ERROR_SUPABASE_CLIENT_CONFIG =
  'supabase_client_config';

function isSupabaseClientMisconfigurationError(e: unknown): boolean {
  if (!(e instanceof Error)) {
    return false;
  }
  const m = e.message;
  return (
    m.includes('Missing NEXT_PUBLIC_SUPABASE_URL') ||
    m.includes('Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY') ||
    m.includes('Missing Supabase URL') ||
    m.includes('Missing Supabase publishable key') ||
    m.includes('Invalid Supabase publishable key')
  );
}

/**
 * Maps preflight errors from practitioner Edge client helpers to user-facing copy.
 *
 * @param err - Caught rejection from those helpers or browser Supabase wiring.
 * @param missingTokenMessage - Copy when the Edge call could not read a usable `access_token`.
 * @returns Message suitable for UI or live regions.
 */
export function practitionerEdgeClientPreflightErrorMessage(
  err: unknown,
  missingTokenMessage: string,
): string {
  if (
    err instanceof Error &&
    err.message === PATIENT_PRACTITIONER_ACCESS_ERROR_MISSING_TOKEN
  ) {
    return missingTokenMessage;
  }
  if (
    err instanceof Error &&
    (err.message === PATIENT_PRACTITIONER_ACCESS_ERROR_SUPABASE_CLIENT_CONFIG ||
      isSupabaseClientMisconfigurationError(err))
  ) {
    return 'Supabase is misconfigured for this app build. Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local (see docs/DEV_SETUP.md).';
  }
  return 'Unable to reach the practitioner invite service. Check your connection and try again.';
}

async function requireAccessToken(): Promise<string> {
  const supabase = createBrowserClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token?.trim()) {
    throw new Error(PATIENT_PRACTITIONER_ACCESS_ERROR_MISSING_TOKEN);
  }
  return session.access_token;
}

async function invokeWithPractitionerClientEnvGuards<T>(
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    if (
      e instanceof Error &&
      e.message === PATIENT_PRACTITIONER_ACCESS_ERROR_MISSING_TOKEN
    ) {
      throw e;
    }
    if (
      e instanceof Error &&
      e.message === PATIENT_PRACTITIONER_ACCESS_ERROR_SUPABASE_CLIENT_CONFIG
    ) {
      throw e;
    }
    if (isSupabaseClientMisconfigurationError(e)) {
      throw new Error(
        PATIENT_PRACTITIONER_ACCESS_ERROR_SUPABASE_CLIENT_CONFIG,
        {
          cause: e,
        },
      );
    }
    throw e;
  }
}

export type PractitionerGrantDto = {
  id: string;
  practitionerUserId: string;
  practitionerEmail: string | null;
  practitionerDisplayName: string | null;
  createdAt: string;
};

/** Pending practitioner email invite (no `practitioner_access` row yet). */
export type PractitionerPendingInviteDto = {
  inviteeEmail: string;
  expiresAt: string;
  lastInviteSentAt: string | null;
  createdAt: string | null;
};

export type PractitionerAccessGetResponse = {
  grants: PractitionerGrantDto[];
  pendingInvite: PractitionerPendingInviteDto | null;
};

/**
 * GET active practitioner grants from the Edge Function.
 *
 * @returns `fetch` Response (caller checks `ok` / `status`).
 */
export async function fetchPatientPractitionerAccessGet(): Promise<Response> {
  return invokeWithPractitionerClientEnvGuards(async () => {
    const token = await requireAccessToken();
    return fetch(patientPractitionerEdgeFunctionsUrl(), {
      headers: bearerHeaders(token, false),
    });
  });
}

/**
 * POST JSON body to the practitioner Edge Function.
 *
 * @param body - Invite, revoke, or resend payload.
 */
export async function fetchPatientPractitionerAccessPostJson(
  body: Record<string, unknown>,
): Promise<Response> {
  return invokeWithPractitionerClientEnvGuards(async () => {
    const token = await requireAccessToken();
    return fetch(patientPractitionerEdgeFunctionsUrl(), {
      method: 'POST',
      headers: bearerHeaders(token, true),
      body: JSON.stringify(body),
    });
  });
}

/**
 * POST invite or link by practitioner email (patient session).
 *
 * @param practitionerEmail - Email address for the practitioner’s ABStrack account.
 */
export async function fetchPatientPractitionerAccessPostInvite(
  practitionerEmail: string,
): Promise<Response> {
  return fetchPatientPractitionerAccessPostJson({ practitionerEmail });
}

/**
 * POST resend Supabase invite email when a **pending invite** matches that email, or an **active grant**
 * already exists for that practitioner (same **`redirectTo`** rules).
 */
export async function fetchPatientPractitionerAccessResendInvite(
  practitionerEmail: string,
): Promise<Response> {
  return fetchPatientPractitionerAccessPostJson({
    practitionerEmail,
    resendPractitionerInvite: true,
  });
}

/**
 * POST revoke practitioner access for the given practitioner user id.
 *
 * @param practitionerUserId - `auth.users` id of the practitioner to revoke.
 */
export async function fetchPatientPractitionerAccessRevoke(
  practitionerUserId: string,
): Promise<Response> {
  return fetchPatientPractitionerAccessPostJson({
    revokePractitionerUserId: practitionerUserId,
  });
}

/**
 * POST cancel a pending practitioner email invite (patient session).
 */
export async function fetchPatientPractitionerAccessCancelPendingInvite(): Promise<Response> {
  return fetchPatientPractitionerAccessPostJson({
    cancelPendingPractitionerInvite: true,
  });
}
