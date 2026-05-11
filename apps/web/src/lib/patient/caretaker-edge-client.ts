'use client';

import { getSupabasePublishableKey, getSupabaseUrl } from '@abstrack/supabase';
import { createBrowserClient } from '@/lib/supabase/browser-client';

/**
 * HTTPS URL for the `patient-caretaker-access` Edge Function (same contract as mobile).
 *
 * @throws Error when `NEXT_PUBLIC_SUPABASE_URL` is unset (build/runtime misconfiguration).
 */
export function patientCaretakerEdgeFunctionsUrl(): string {
  const base = getSupabaseUrl().replace(/\/$/, '');
  return `${base}/functions/v1/patient-caretaker-access`;
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

/**
 * `Error.message` from {@link requireAccessToken} when there is no usable session
 * (Supabase `getSession` error or empty `access_token`). Callers can treat other
 * thrown errors as connectivity / unexpected failures.
 */
export const PATIENT_CARETAKER_ACCESS_ERROR_MISSING_TOKEN =
  'missing_access_token';

async function requireAccessToken(): Promise<string> {
  const supabase = createBrowserClient();
  const {
    data: { session },
    error,
  } = await supabase.auth.getSession();
  if (error || !session?.access_token?.trim()) {
    throw new Error(PATIENT_CARETAKER_ACCESS_ERROR_MISSING_TOKEN);
  }
  return session.access_token;
}

export type CaretakerGrantDto = {
  id: string;
  caretakerUserId: string;
  caretakerDisplayName: string | null;
  createdAt: string;
};

export type CaretakerPendingInviteDto = {
  inviteeEmail: string;
  expiresAt: string;
  lastInviteSentAt: string | null;
  createdAt: string | null;
};

export type CaretakerAccessGetResponse = {
  grant: CaretakerGrantDto | null;
  pendingInvite: CaretakerPendingInviteDto | null;
};

/**
 * GET current caretaker grant and any pending email invite from the Edge Function.
 *
 * @returns `fetch` Response (caller checks `ok` / `status`).
 */
export async function fetchPatientCaretakerAccessGet(): Promise<Response> {
  const token = await requireAccessToken();
  return fetch(patientCaretakerEdgeFunctionsUrl(), {
    headers: bearerHeaders(token, false),
  });
}

/**
 * POST JSON body to the caretaker Edge Function (patient or caretaker flows).
 *
 * @param body - Discriminated payload (`caretakerEmail`, cancel, finalize, etc.).
 */
export async function fetchPatientCaretakerAccessPostJson(
  body: Record<string, unknown>,
): Promise<Response> {
  const token = await requireAccessToken();
  return fetch(patientCaretakerEdgeFunctionsUrl(), {
    method: 'POST',
    headers: bearerHeaders(token, true),
    body: JSON.stringify(body),
  });
}

/**
 * POST invite or link by email (patient session).
 *
 * @param caretakerEmail - Email address to invite or link.
 */
export async function fetchPatientCaretakerAccessPost(
  caretakerEmail: string,
): Promise<Response> {
  return fetchPatientCaretakerAccessPostJson({ caretakerEmail });
}

/**
 * POST cancel a pending caretaker email invite (patient session).
 */
export async function fetchPatientCaretakerAccessCancelPendingInvite(): Promise<Response> {
  return fetchPatientCaretakerAccessPostJson({
    cancelPendingCaretakerInvite: true,
  });
}

/**
 * POST complete caretaker invite after email link (caretaker session).
 *
 * @param inviteId - `caretaker_invites.id` echoed in `user_metadata.abstrack_caretaker_invite_id`.
 */
export async function fetchPatientCaretakerAccessFinalize(
  inviteId: string,
): Promise<Response> {
  return fetchPatientCaretakerAccessPostJson({
    finalizeCaretakerInvite: true,
    inviteId,
  });
}

/**
 * DELETE revoke active caretaker grant.
 */
export async function fetchPatientCaretakerAccessDelete(): Promise<Response> {
  const token = await requireAccessToken();
  return fetch(patientCaretakerEdgeFunctionsUrl(), {
    method: 'DELETE',
    headers: bearerHeaders(token, false),
  });
}
