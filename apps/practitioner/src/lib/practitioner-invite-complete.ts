import { getSupabasePublishableKey, getSupabaseUrl } from '@abstrack/supabase';

/**
 * HTTPS URL for the **`patient-practitioner-access`** Edge Function (same project URL as the
 * practitioner Supabase client).
 *
 * @throws When **`getSupabaseUrl`** rejects (misconfigured env).
 */
function patientPractitionerEdgeFunctionsUrl(): string {
  const base = getSupabaseUrl().replace(/\/$/, '');
  return `${base}/functions/v1/patient-practitioner-access`;
}

/**
 * Result of calling **`finalizePractitionerInvite`** after the practitioner completes the email link.
 */
export type CompletePractitionerInviteResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * POST **`{ finalizePractitionerInvite: true, inviteId }`** to the patient practitioner Edge
 * Function using the **practitioner** session (Bearer + publishable **`apikey`** gateway header).
 *
 * @param accessToken - Current Supabase session access token (JWT).
 * @param inviteId - `practitioner_invites.id` from **`user_metadata.abstrack_practitioner_invite_id`**.
 * @returns Success, or a user-visible error message.
 */
export async function completePractitionerInviteAfterAuth(
  accessToken: string,
  inviteId: string,
): Promise<CompletePractitionerInviteResult> {
  if (!accessToken.trim()) {
    return {
      ok: false,
      message: 'No active session after opening the invite link.',
    };
  }
  if (!inviteId.trim()) {
    return {
      ok: false,
      message:
        'Missing invite on this sign-in. Ask the patient to resend the invite from their settings.',
    };
  }

  let publishableKey: string;
  try {
    publishableKey = getSupabasePublishableKey();
  } catch {
    return {
      ok: false,
      message:
        'Missing Supabase publishable key. Set NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/practitioner/.env (see docs).',
    };
  }

  let url: string;
  try {
    url = patientPractitionerEdgeFunctionsUrl();
  } catch {
    return {
      ok: false,
      message:
        'Missing Supabase URL. Set NEXT_PUBLIC_SUPABASE_URL in apps/practitioner/.env.',
    };
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: publishableKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        finalizePractitionerInvite: true,
        inviteId: inviteId.trim(),
      }),
    });
  } catch (e) {
    const detail =
      e instanceof Error && e.message.trim().length > 0 ? ` ${e.message}` : '';
    return {
      ok: false,
      message:
        'Unable to reach the server to finish linking to the patient right now. Please check your connection and try again.' +
        detail,
    };
  }

  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const msg =
      typeof body.error === 'string' && body.error.trim().length > 0
        ? body.error
        : 'Unable to finish linking to the patient right now.';
    return { ok: false, message: msg };
  }

  return { ok: true };
}
