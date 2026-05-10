import {
  CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP,
  fetchCaretakerAccessPostJson,
  isMissingPublishableKeyForCaretakerEdge,
  resolvePatientCaretakerAccessUrl,
} from './patient-user-web-api';
import { getMobileSupabaseClient } from './supabase-wiring';

/**
 * Result of finishing a patient-sent caretaker invite after the invitee has a Supabase session.
 */
export type CompleteCaretakerInviteResult =
  | { ok: true }
  | { ok: false; message: string };

/**
 * After `exchangeCodeForSession` from a caretaker invite deep link: ensure a **caretaker** profile
 * row exists, then call the Edge function to create `caretaker_access` and consume the invite.
 *
 * @returns Success, or a user-visible error message.
 */
export async function completeCaretakerInviteAfterAuth(): Promise<CompleteCaretakerInviteResult> {
  const supabase = getMobileSupabaseClient();
  const {
    data: { session },
    error: sessErr,
  } = await supabase.auth.getSession();

  if (sessErr || !session?.user || !session.access_token?.trim()) {
    return {
      ok: false,
      message: 'No active session after opening the invite link.',
    };
  }

  const inviteIdRaw = session.user.user_metadata?.abstrack_caretaker_invite_id;
  const inviteId =
    typeof inviteIdRaw === 'string' && inviteIdRaw.trim().length > 0
      ? inviteIdRaw.trim()
      : null;

  if (!inviteId) {
    return {
      ok: false,
      message:
        'Missing invite on this sign-in. Ask the patient to resend the invite from their settings.',
    };
  }

  const { data: profile, error: readPErr } = await supabase
    .from('profiles')
    .select('app_role')
    .eq('id', session.user.id)
    .maybeSingle();

  if (readPErr) {
    return {
      ok: false,
      message: readPErr.message || 'Unable to read your profile.',
    };
  }

  if (!profile) {
    const { error: insPErr } = await supabase.from('profiles').insert({
      id: session.user.id,
      app_role: 'caretaker',
    });
    if (insPErr) {
      return {
        ok: false,
        message:
          insPErr.message ||
          'Unable to create your caretaker profile. Try again or contact support.',
      };
    }
  } else if (profile.app_role !== 'caretaker') {
    return {
      ok: false,
      message:
        'This ABStrack account is not a caretaker profile. Use the email address the patient invited, or contact support.',
    };
  }

  if (!resolvePatientCaretakerAccessUrl()) {
    return {
      ok: false,
      message:
        'Missing EXPO_PUBLIC_SUPABASE_URL. Add it so the app can finish linking to the patient.',
    };
  }

  let res: Response;
  try {
    res = await fetchCaretakerAccessPostJson(session.access_token, {
      finalizeCaretakerInvite: true,
      inviteId,
    });
  } catch (e) {
    if (isMissingPublishableKeyForCaretakerEdge(e)) {
      return { ok: false, message: CARETAKER_EDGE_PUBLISHABLE_KEY_ENV_HELP };
    }
    throw e;
  }
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) {
    const msg =
      typeof body.error === 'string'
        ? body.error
        : 'Unable to finish linking to the patient right now.';
    return { ok: false, message: msg };
  }

  return { ok: true };
}
