/**
 * Patient caretaker grants (`caretaker_access`) and **email invites** (`caretaker_invites`).
 * Verified session + elevated Supabase client (default secret key from `SUPABASE_SECRET_KEYS`).
 * User web + mobile call `…/functions/v1/patient-caretaker-access` with user JWT + `apikey` (publishable).
 *
 * HTTP:
 * - **GET** — patient: active grant + pending invite (if any).
 * - **POST** — patient: `{ caretakerEmail }` send invite or link existing caretaker; `{ cancelPendingCaretakerInvite: true }` cancel pending invite; caretaker: `{ finalizeCaretakerInvite: true, inviteId }` after accepting email invite.
 * - **DELETE** — patient: revoke active caretaker grant (clears pending invites too).
 *
 * **Invite email:** uses `auth.admin.inviteUserByEmail` with `redirectTo` `${ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN}/auth/callback?next=/caretaker/join` (set Edge secret; must match Supabase Auth redirect allow list).
 *
 * @see https://supabase.com/docs/guides/functions/secrets
 *
 * Deploy: `pnpm dlx supabase functions deploy patient-caretaker-access`
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import {
  createClient,
  type SupabaseClient,
  type User,
} from 'jsr:@supabase/supabase-js@2';

import { readDefaultSupabaseSecretKeyFromEnv } from '../_shared/read-default-supabase-secret-key.ts';

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
};

const ALLOW_METHODS = 'GET, POST, DELETE, OPTIONS';

const BEARER_AUTH_RE = /^\s*Bearer\s+(.*)$/i;

const INVITE_VALID_DAYS = 14;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function parseBearerToken(authorization: string | null): string | null {
  if (authorization == null || authorization === '') {
    return null;
  }
  const m = authorization.match(BEARER_AUTH_RE);
  const raw = m?.[1]?.trim() ?? '';
  return raw.length > 0 ? raw : null;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
  extraHeaders?: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
  });
}

const WWW_AUTHENTICATE_BEARER = 'Bearer';

function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: 'Sign in to continue.' }), {
    status: 401,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json',
      'WWW-Authenticate': WWW_AUTHENTICATE_BEARER,
      'Access-Control-Expose-Headers': 'WWW-Authenticate',
    },
  });
}

function normalizeEmailForLookup(raw: string): string {
  return raw.trim().toLowerCase();
}

function inviteExpiresAtIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + INVITE_VALID_DAYS);
  return d.toISOString();
}

function isUuidString(s: string): boolean {
  return UUID_RE.test(s);
}

const LIST_USERS_PER_PAGE = 500;
const LIST_USERS_MAX_PAGES = 40;

async function resolveAuthUserIdByEmail(
  admin: SupabaseClient,
  rawEmail: string,
): Promise<string | null> {
  const target = normalizeEmailForLookup(rawEmail);
  if (!target) {
    return null;
  }
  for (let page = 1; page <= LIST_USERS_MAX_PAGES; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: LIST_USERS_PER_PAGE,
    });
    if (error) {
      throw error;
    }
    const users: User[] = data.users;
    const hit = users.find(
      (u) => typeof u.email === 'string' && u.email.toLowerCase() === target,
    );
    if (hit) {
      return hit.id;
    }
    if (users.length < LIST_USERS_PER_PAGE) {
      return null;
    }
  }
  return null;
}

function isPostgresUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === '23505'
  );
}

async function clearPendingInvitesForPatient(
  admin: SupabaseClient,
  patientUserId: string,
): Promise<void> {
  await admin
    .from('caretaker_invites')
    .delete()
    .eq('patient_user_id', patientUserId)
    .is('consumed_at', null);
}

async function handleFinalizeCaretakerInvite(
  admin: SupabaseClient,
  user: User,
  inviteId: string,
): Promise<Response> {
  if (!isUuidString(inviteId)) {
    return jsonResponse(400, { error: 'invalid_invite_id' });
  }

  const emailNorm = user.email ? normalizeEmailForLookup(user.email) : '';
  if (!emailNorm) {
    return jsonResponse(400, {
      error: 'Your account must have an email address to complete this invite.',
    });
  }

  const metaInviteId = user.user_metadata?.abstrack_caretaker_invite_id;
  if (
    typeof metaInviteId === 'string' &&
    metaInviteId.length > 0 &&
    metaInviteId !== inviteId
  ) {
    return jsonResponse(403, {
      error:
        'This session does not match the latest invite link. Open the link from the most recent email.',
    });
  }

  const { data: invite, error: invErr } = await admin
    .from('caretaker_invites')
    .select(
      'id, patient_user_id, invitee_email_normalized, expires_at, consumed_at',
    )
    .eq('id', inviteId)
    .maybeSingle();

  if (invErr || !invite) {
    return jsonResponse(404, {
      error: 'Invite not found or already used.',
    });
  }

  if (invite.consumed_at != null) {
    return jsonResponse(409, { error: 'This invite was already completed.' });
  }

  if (Number.isNaN(Date.parse(invite.expires_at as string))) {
    return jsonResponse(500, { error: 'Invite data is invalid.' });
  }
  if (Date.now() > Date.parse(invite.expires_at as string)) {
    return jsonResponse(410, {
      error:
        'This invite has expired. Ask the patient to send a new invite from their settings.',
    });
  }

  if ((invite.invitee_email_normalized as string) !== emailNorm) {
    return jsonResponse(403, {
      error: 'Sign in with the same email address the patient invited.',
    });
  }

  const { data: crProfile, error: pErr } = await admin
    .from('profiles')
    .select('app_role')
    .eq('id', user.id)
    .maybeSingle();

  if (pErr) {
    return jsonResponse(500, { error: 'Unable to verify your profile.' });
  }
  if (!crProfile || crProfile.app_role !== 'caretaker') {
    return jsonResponse(403, {
      error:
        'Create your ABStrack profile as a caretaker first, then return to this page to finish.',
    });
  }

  const patientId = invite.patient_user_id as string;
  if (patientId === user.id) {
    return jsonResponse(400, { error: 'Invalid invite.' });
  }

  const { data: otherActive, error: oaErr } = await admin
    .from('caretaker_access')
    .select('id, caretaker_user_id')
    .eq('patient_user_id', patientId)
    .is('revoked_at', null)
    .maybeSingle();

  if (oaErr) {
    console.error('finalize otherActive', oaErr);
    return jsonResponse(500, {
      error: 'Unable to verify patient caretaker slot.',
    });
  }
  if (otherActive && otherActive.caretaker_user_id !== user.id) {
    return jsonResponse(409, {
      error:
        'This patient already has another active caretaker. They must revoke access before you can join.',
    });
  }

  const { data: existingPair, error: pairError } = await admin
    .from('caretaker_access')
    .select('id, revoked_at')
    .eq('patient_user_id', patientId)
    .eq('caretaker_user_id', user.id)
    .maybeSingle();

  if (pairError) {
    console.error('finalize pair lookup', pairError);
    return jsonResponse(500, {
      error: 'Unable to verify existing caretaker access.',
    });
  }

  const nowIso = new Date().toISOString();

  if (existingPair?.revoked_at == null && existingPair) {
    await admin
      .from('caretaker_invites')
      .update({
        consumed_at: nowIso,
        consumed_caretaker_user_id: user.id,
      })
      .eq('id', inviteId);
    return jsonResponse(200, { ok: true, outcome: 'already_linked' });
  }

  if (existingPair && existingPair.revoked_at != null) {
    const { error: updError } = await admin
      .from('caretaker_access')
      .update({ revoked_at: null })
      .eq('id', existingPair.id);

    if (updError) {
      console.error('finalize reactivate', updError);
      return jsonResponse(500, {
        error: 'Unable to restore caretaker access.',
      });
    }
  } else {
    const { error: insError } = await admin.from('caretaker_access').insert({
      patient_user_id: patientId,
      caretaker_user_id: user.id,
    });

    if (insError) {
      if (isPostgresUniqueViolation(insError)) {
        return jsonResponse(409, {
          error:
            'This patient already has another active caretaker. They must revoke access before you can join.',
        });
      }
      console.error('finalize insert', insError);
      return jsonResponse(500, { error: 'Unable to link caretaker access.' });
    }
  }

  await admin
    .from('caretaker_invites')
    .update({
      consumed_at: nowIso,
      consumed_caretaker_user_id: user.id,
    })
    .eq('id', inviteId);

  return jsonResponse(200, { ok: true, outcome: 'linked' });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!['GET', 'POST', 'DELETE'].includes(req.method)) {
    return jsonResponse(
      405,
      { error: 'method_not_allowed' },
      {
        Allow: ALLOW_METHODS,
      },
    );
  }

  const token = parseBearerToken(req.headers.get('Authorization'));
  if (token == null) {
    return unauthorizedResponse();
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const secretApiKey = readDefaultSupabaseSecretKeyFromEnv();
  if (!supabaseUrl || !secretApiKey) {
    return jsonResponse(500, { error: 'server_misconfigured' });
  }

  const admin = createClient(supabaseUrl, secretApiKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) {
    return unauthorizedResponse();
  }
  const user = userData.user;

  let postBody: Record<string, unknown> | undefined;
  if (req.method === 'POST') {
    try {
      postBody = (await req.json()) as Record<string, unknown>;
    } catch {
      return jsonResponse(400, { error: 'Expected JSON body.' });
    }

    if (postBody.finalizeCaretakerInvite === true) {
      const inviteId = postBody.inviteId;
      if (typeof inviteId !== 'string' || !inviteId.trim()) {
        return jsonResponse(400, { error: 'inviteId is required.' });
      }
      return await handleFinalizeCaretakerInvite(admin, user, inviteId.trim());
    }
  }

  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('app_role')
    .eq('id', user.id)
    .maybeSingle();

  if (profileError) {
    return jsonResponse(500, { error: 'Unable to verify your account.' });
  }

  if (profile?.app_role !== 'patient') {
    return jsonResponse(403, {
      error:
        'Only patient accounts can manage caretaker access from this endpoint.',
    });
  }

  if (req.method === 'GET') {
    const { data: active, error: grantError } = await admin
      .from('caretaker_access')
      .select('id, caretaker_user_id, created_at')
      .eq('patient_user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle();

    if (grantError) {
      console.error('caretaker_access GET', grantError);
      return jsonResponse(500, {
        error: 'Unable to load caretaker access right now.',
      });
    }

    const { data: pending, error: pendErr } = await admin
      .from('caretaker_invites')
      .select(
        'invitee_email_normalized, expires_at, last_invite_sent_at, created_at',
      )
      .eq('patient_user_id', user.id)
      .is('consumed_at', null)
      .maybeSingle();

    if (pendErr) {
      console.error('caretaker_invites GET', pendErr);
      return jsonResponse(500, {
        error: 'Unable to load caretaker access right now.',
      });
    }

    let grant: Record<string, unknown> | null = null;
    if (active) {
      const { data: caretakerProfile, error: caretakerProfileError } =
        await admin
          .from('profiles')
          .select('display_name')
          .eq('id', active.caretaker_user_id)
          .maybeSingle();

      if (caretakerProfileError) {
        console.error('caretaker profile GET', caretakerProfileError);
        return jsonResponse(500, {
          error: 'Unable to load caretaker access right now.',
        });
      }

      grant = {
        id: active.id,
        caretakerUserId: active.caretaker_user_id,
        caretakerDisplayName: caretakerProfile?.display_name ?? null,
        createdAt: active.created_at,
      };
    }

    const pendingInvite =
      pending &&
      typeof pending.invitee_email_normalized === 'string' &&
      typeof pending.expires_at === 'string'
        ? {
            inviteeEmail: pending.invitee_email_normalized,
            expiresAt: pending.expires_at,
            lastInviteSentAt: pending.last_invite_sent_at ?? null,
            createdAt: pending.created_at ?? null,
          }
        : null;

    return jsonResponse(200, { grant, pendingInvite });
  }

  if (req.method === 'DELETE') {
    const { data: active, error: activeError } = await admin
      .from('caretaker_access')
      .select('id')
      .eq('patient_user_id', user.id)
      .is('revoked_at', null)
      .maybeSingle();

    if (activeError) {
      console.error('caretaker_access DELETE lookup', activeError);
      return jsonResponse(500, {
        error: 'Unable to revoke caretaker access right now.',
      });
    }

    if (!active) {
      await clearPendingInvitesForPatient(admin, user.id);
      return jsonResponse(404, {
        error: 'There is no active caretaker to revoke.',
      });
    }

    const { error: updError } = await admin
      .from('caretaker_access')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', active.id)
      .is('revoked_at', null);

    if (updError) {
      console.error('caretaker_access revoke', updError);
      return jsonResponse(500, {
        error: 'Unable to revoke caretaker access right now.',
      });
    }

    await clearPendingInvitesForPatient(admin, user.id);

    return jsonResponse(200, { ok: true });
  }

  // POST — patient (finalize handled above)
  if (!postBody) {
    return jsonResponse(400, { error: 'Expected JSON body.' });
  }

  if (postBody.cancelPendingCaretakerInvite === true) {
    await clearPendingInvitesForPatient(admin, user.id);
    return jsonResponse(200, { ok: true, outcome: 'invite_cancelled' });
  }

  const rawEmail = postBody.caretakerEmail;
  if (typeof rawEmail !== 'string' || !normalizeEmailForLookup(rawEmail)) {
    return jsonResponse(400, { error: 'Enter the caretaker’s email address.' });
  }

  const normalizedTarget = normalizeEmailForLookup(rawEmail);

  const { data: otherActive, error: otherActiveError } = await admin
    .from('caretaker_access')
    .select('id, caretaker_user_id')
    .eq('patient_user_id', user.id)
    .is('revoked_at', null)
    .maybeSingle();

  if (otherActiveError) {
    console.error('caretaker_access other active', otherActiveError);
    return jsonResponse(500, {
      error: 'Unable to verify existing caretaker access.',
    });
  }

  let caretakerUserId: string | null = null;
  try {
    caretakerUserId = await resolveAuthUserIdByEmail(admin, rawEmail);
  } catch (e) {
    console.error('resolveAuthUserIdByEmail', e);
    return jsonResponse(500, {
      error: 'Unable to look up that email right now.',
    });
  }

  if (caretakerUserId === user.id) {
    return jsonResponse(400, {
      error: 'You cannot link your own account as caretaker.',
    });
  }

  if (caretakerUserId) {
    if (otherActive && otherActive.caretaker_user_id !== caretakerUserId) {
      return jsonResponse(409, {
        error:
          'You already have an active caretaker. Revoke access before linking someone else.',
      });
    }

    const { data: caretakerProfile, error: caretakerProfileError } = await admin
      .from('profiles')
      .select('app_role')
      .eq('id', caretakerUserId)
      .maybeSingle();

    if (caretakerProfileError) {
      console.error('caretaker profile for link', caretakerProfileError);
      return jsonResponse(500, {
        error: 'Unable to verify the caretaker account.',
      });
    }

    if (!caretakerProfile) {
      return jsonResponse(404, {
        error:
          'That account exists but has no profile yet. Ask them to finish signing in once, then try again.',
      });
    }

    if (caretakerProfile.app_role !== 'caretaker') {
      return jsonResponse(422, {
        error:
          'That account is not registered as a caretaker. It must use the caretaker sign-up path—not the same role as a healthcare practitioner.',
      });
    }

    const { data: existingPair, error: pairError } = await admin
      .from('caretaker_access')
      .select('id, revoked_at')
      .eq('patient_user_id', user.id)
      .eq('caretaker_user_id', caretakerUserId)
      .maybeSingle();

    if (pairError) {
      console.error('caretaker_access pair lookup', pairError);
      return jsonResponse(500, {
        error: 'Unable to verify existing caretaker access.',
      });
    }

    if (existingPair?.revoked_at == null && existingPair) {
      await clearPendingInvitesForPatient(admin, user.id);
      return jsonResponse(200, { ok: true, outcome: 'already_linked' });
    }

    if (existingPair && existingPair.revoked_at != null) {
      const { error: updError } = await admin
        .from('caretaker_access')
        .update({ revoked_at: null })
        .eq('id', existingPair.id);

      if (updError) {
        console.error('caretaker_access reactivate', updError);
        return jsonResponse(500, {
          error: 'Unable to restore caretaker access.',
        });
      }
      await clearPendingInvitesForPatient(admin, user.id);
      return jsonResponse(200, {
        ok: true,
        outcome: 'linked',
        reactivated: true,
      });
    }

    const { error: insError } = await admin.from('caretaker_access').insert({
      patient_user_id: user.id,
      caretaker_user_id: caretakerUserId,
    });

    if (insError) {
      if (isPostgresUniqueViolation(insError)) {
        return jsonResponse(409, {
          error:
            'You already have an active caretaker. Revoke access before linking someone else.',
        });
      }
      console.error('caretaker_access insert', insError);
      return jsonResponse(500, { error: 'Unable to link caretaker access.' });
    }

    await clearPendingInvitesForPatient(admin, user.id);
    return jsonResponse(200, {
      ok: true,
      outcome: 'linked',
      reactivated: false,
    });
  }

  // No Auth user for this email — send Supabase invite email + pending row
  if (otherActive) {
    return jsonResponse(409, {
      error:
        'You already have an active caretaker. Revoke access before inviting someone else.',
    });
  }

  const inviteOrigin = (
    Deno.env.get('ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN') ?? ''
  ).replace(/\/$/, '');
  if (!inviteOrigin) {
    console.error(
      'Missing ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN (e.g. https://your-user-web.example)',
    );
    return jsonResponse(500, {
      error: 'server_misconfigured',
    });
  }

  const redirectTo = `${inviteOrigin}/auth/callback?next=${encodeURIComponent('/caretaker/join')}`;

  await clearPendingInvitesForPatient(admin, user.id);

  const expiresAt = inviteExpiresAtIso();
  const { data: invRow, error: insInvErr } = await admin
    .from('caretaker_invites')
    .insert({
      patient_user_id: user.id,
      invitee_email_normalized: normalizedTarget,
      expires_at: expiresAt,
    })
    .select('id')
    .single();

  if (insInvErr || !invRow?.id) {
    console.error('caretaker_invites insert', insInvErr);
    return jsonResponse(500, { error: 'Unable to create caretaker invite.' });
  }

  const inviteId = invRow.id as string;

  const { error: invMailErr } = await admin.auth.admin.inviteUserByEmail(
    normalizedTarget,
    {
      data: { abstrack_caretaker_invite_id: inviteId },
      redirectTo,
    },
  );

  if (invMailErr) {
    const msg = (invMailErr as { message?: string }).message ?? '';
    const lower = msg.toLowerCase();
    if (
      lower.includes('already') ||
      lower.includes('registered') ||
      lower.includes('exists')
    ) {
      await admin.from('caretaker_invites').delete().eq('id', inviteId);
      return jsonResponse(409, {
        error:
          'An account already exists for that email. Ask them to sign in as a caretaker, or use “link” after they finish signup.',
      });
    }
    console.error('inviteUserByEmail', invMailErr);
    await admin.from('caretaker_invites').delete().eq('id', inviteId);
    return jsonResponse(500, {
      error:
        'Unable to send the invite email right now. Try again in a moment.',
    });
  }

  await admin
    .from('caretaker_invites')
    .update({ last_invite_sent_at: new Date().toISOString() })
    .eq('id', inviteId);

  return jsonResponse(200, {
    ok: true,
    outcome: 'invite_sent',
    inviteExpiresAt: expiresAt,
  });
});
