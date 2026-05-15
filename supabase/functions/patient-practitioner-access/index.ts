/**
 * Patient-initiated **`practitioner_access`** grants and practitioner email invites (PRD §8).
 * Verified patient session + elevated Supabase client (default secret key from `SUPABASE_SECRET_KEYS`).
 * Writes use **service_role**; RLS includes explicit `TO service_role` policies in
 * `supabase/migrations/20260514120000_practitioner_access_service_role_edge.sql` (**`practitioner_access`**
 * service_role INSERT/UPDATE, **`list_practitioner_auth_emails_for_patient_grants`**),
 * **`20260515180000_practitioner_invites.sql`** (**`practitioner_invites`**, **`stamp_practitioner_invite_pre_send`**),
 * and **`20260516200000_practitioner_access_last_invite_email_sent_at.sql`**
 * (**`practitioner_access.last_invite_email_sent_at`**, **`stamp_practitioner_access_last_invite_email_sent_at`**).
 * User web + mobile call `…/functions/v1/patient-practitioner-access` with user JWT + `apikey` (publishable).
 *
 * Practitioner data reads remain **fail-closed** on MFA (AAL2) via RLS and
 * `practitioner-mfa-auth-audit`; this function only manages the **grant row** and Auth invite.
 * Revoking sets **`revoked_at`** (patient data the practitioner already saw is not erased; future
 * reads are denied by RLS per PRD).
 *
 * HTTP:
 * - **GET** — patient: list active practitioner grants (email + display name from Auth/ profiles)
 *   and optional **`pendingInvite`** from **`practitioner_invites`** (caretaker-style pending email
 *   invite before a grant row exists).
 *   Practitioner emails load in one **`list_practitioner_auth_emails_for_patient_grants`** RPC (joins
 *   **`practitioner_access`** + **`auth.users`**) instead of per-id GoTrue admin calls.
 * - **POST** — patient: `{ practitionerEmail }` send **`inviteUserByEmail`** for new Auth users with
 *   **`practitioner_invites`** + metadata **`abstrack_practitioner_invite_id`** (no **`practitioner_access`**
 *   until the invitee finalizes); **link** an existing Auth user when **`profiles.app_role`** is already
 *   **`practitioner`** (no profile auto-create on link — avoids role escalation);
 *   `{ revokePractitionerUserId }` set **`revoked_at`** on the matching active grant;
 *   `{ cancelPendingPractitionerInvite: true }` remove the pending invite row (best-effort orphan Auth cleanup);
 *   `{ practitionerEmail, resendPractitionerInvite: true }` resend when a matching **pending invite** exists
 *   or an **active grant** exists for that email (same **`redirectTo`** rules). If Auth reports the address
 *   is already registered on an active-grant resend, returns **200** + **`outcome: invite_not_needed`**.
 *   Invite/resend emails are **throttled** (**`429`** + **`Retry-After`**, min interval 90s): pending
 *   flows use **`practitioner_invites.last_invite_sent_at`** + **`stamp_practitioner_invite_pre_send`**
 *   (caretaker parity); **active-grant** **`inviteUserByEmail`** resends use
 *   **`practitioner_access.last_invite_email_sent_at`** + **`stamp_practitioner_access_last_invite_email_sent_at`**.
 * - **POST** (practitioner session): `{ finalizePractitionerInvite: true, inviteId }` after accepting the
 *   email link — creates **`practitioner_access`**, consumes **`practitioner_invites`**, clears
 *   **`user_metadata.abstrack_practitioner_invite_id`** on success (**200** retry-safe when already
 *   finalized for this practitioner).
 *
 * **Invite email:** `auth.admin.inviteUserByEmail` **`redirectTo`** is **`ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO`**
 * when set (trimmed). Otherwise **`{origin}/auth/callback?next=/`** from **`ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN`**
 * (trimmed, trailing slashes stripped, absolute **http** or **https**). Values must appear in Supabase Auth
 * **Redirect URLs** for the practitioner web app host.
 *
 * **Secrets (hosted):** `SUPABASE_URL`, `SUPABASE_SECRET_KEYS` (`default` secret key). Legacy
 * `SUPABASE_SERVICE_ROLE_KEY` is not used.
 *
 * @see https://supabase.com/docs/guides/functions/secrets
 *
 * Deploy: `pnpm dlx supabase functions deploy patient-practitioner-access`
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
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const ALLOW_METHODS = 'GET, POST, OPTIONS';

const BEARER_AUTH_RE = /^\s*Bearer\s+(.*)$/i;

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

/**
 * Same plausibility rules as caretaker invites (Edge `patient-caretaker-access`).
 *
 * @param normalized - Lowercased trimmed email.
 */
function isPlausiblePractitionerInviteEmail(normalized: string): boolean {
  if (normalized.length < 3 || normalized.length > 254) {
    return false;
  }
  if (/\s/.test(normalized)) {
    return false;
  }
  const at = normalized.indexOf('@');
  if (at <= 0 || at !== normalized.lastIndexOf('@')) {
    return false;
  }
  const local = normalized.slice(0, at);
  const domain = normalized.slice(at + 1);
  if (local.length === 0 || domain.length === 0) {
    return false;
  }
  if (!domain.includes('.')) {
    return false;
  }
  if (domain.startsWith('.') || domain.endsWith('.') || domain.includes('..')) {
    return false;
  }
  return true;
}

/** Minimum interval between practitioner **`inviteUserByEmail`** sends for the same patient + email (ms). */
const PRACTITIONER_INVITE_MIN_RESEND_INTERVAL_MS = 90_000;

const PRACTITIONER_INVITE_VALID_DAYS = 14;

/**
 * When remaining time to **`expires_at`** falls below this threshold, a resend refreshes
 * **`practitioner_invites.expires_at`** so finalize does not immediately return **410** on an old row.
 */
const PRACTITIONER_INVITE_RESEND_REFRESH_EXPIRY_REMAINING_MS =
  48 * 60 * 60 * 1000;

/**
 * @param lastInviteSentAt - ISO time of last recorded invite email send (`practitioner_invites` or
 *   `practitioner_access` throttle column).
 * @param nowMs - Current epoch milliseconds.
 */
function practitionerInviteResendTooSoon(
  lastInviteSentAt: string | null | undefined,
  nowMs: number,
): { tooSoon: true; retryAfterSec: number } | { tooSoon: false } {
  if (lastInviteSentAt == null || lastInviteSentAt === '') {
    return { tooSoon: false };
  }
  const t = Date.parse(lastInviteSentAt);
  if (!Number.isFinite(t)) {
    return { tooSoon: false };
  }
  const elapsed = nowMs - t;
  if (elapsed >= PRACTITIONER_INVITE_MIN_RESEND_INTERVAL_MS) {
    return { tooSoon: false };
  }
  return {
    tooSoon: true,
    retryAfterSec: Math.max(
      1,
      Math.ceil((PRACTITIONER_INVITE_MIN_RESEND_INTERVAL_MS - elapsed) / 1000),
    ),
  };
}

/**
 * Atomically stamps **`practitioner_access.last_invite_email_sent_at`** before **`inviteUserByEmail`**
 * for an **active grant** resend (no pending **`practitioner_invites`** row). Returns **429** when inside
 * the resend window.
 */
async function stampPractitionerAccessInviteEmailSentAtOr429(
  admin: SupabaseClient,
  patientUserId: string,
  practitionerUserId: string,
  nowMs: number,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const stampNowIso = new Date(nowMs).toISOString();
  const throttleCutoffIso = new Date(
    nowMs - PRACTITIONER_INVITE_MIN_RESEND_INTERVAL_MS,
  ).toISOString();

  const { data: stampedRows, error: stampErr } = await admin.rpc(
    'stamp_practitioner_access_last_invite_email_sent_at',
    {
      p_patient_user_id: patientUserId,
      p_practitioner_user_id: practitionerUserId,
      p_stamp: stampNowIso,
      p_throttle_cutoff: throttleCutoffIso,
    },
  );

  if (stampErr) {
    console.error(
      'stamp_practitioner_access_last_invite_email_sent_at',
      stampErr,
    );
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to record the invite send. Try again in a moment.',
      }),
    };
  }

  const stampedCount = Array.isArray(stampedRows) ? stampedRows.length : 0;
  if (stampedCount === 1) {
    return { ok: true };
  }
  if (stampedCount > 1) {
    console.error(
      'stamp_practitioner_access_last_invite_email_sent_at unexpected row count',
      stampedCount,
    );
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to verify the invite send. Try again in a moment.',
      }),
    };
  }

  const { data: row, error: readErr } = await admin
    .from('practitioner_access')
    .select('last_invite_email_sent_at')
    .eq('patient_user_id', patientUserId)
    .eq('practitioner_user_id', practitionerUserId)
    .is('revoked_at', null)
    .maybeSingle();

  if (readErr) {
    console.error(
      'practitioner_access last_invite_email_sent_at read',
      readErr,
    );
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to verify the invite send. Try again in a moment.',
      }),
    };
  }

  const throttle = practitionerInviteResendTooSoon(
    row?.last_invite_email_sent_at as string | null | undefined,
    nowMs,
  );
  if (throttle.tooSoon) {
    return {
      ok: false,
      response: jsonResponse(
        429,
        {
          error: 'Please wait before resending the invite.',
          retryAfterSeconds: throttle.retryAfterSec,
        },
        {
          'Retry-After': String(throttle.retryAfterSec),
        },
      ),
    };
  }

  return {
    ok: false,
    response: jsonResponse(
      429,
      {
        error: 'Please wait before sending another invite.',
        retryAfterSeconds: 60,
      },
      { 'Retry-After': '60' },
    ),
  };
}

function isUuidString(s: string): boolean {
  return UUID_RE.test(s);
}

function practitionerInviteExpiresAtIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + PRACTITIONER_INVITE_VALID_DAYS);
  return d.toISOString();
}

/**
 * @param expiresAtIso - `practitioner_invites.expires_at`.
 * @param nowMs - Current epoch milliseconds.
 */
function practitionerInviteShouldRefreshExpiry(
  expiresAtIso: string,
  nowMs: number,
): boolean {
  const t = Date.parse(expiresAtIso);
  if (!Number.isFinite(t)) {
    return true;
  }
  return t - nowMs < PRACTITIONER_INVITE_RESEND_REFRESH_EXPIRY_REMAINING_MS;
}

async function refreshPractitionerInviteExpiryIfNeeded(
  admin: SupabaseClient,
  inviteId: string,
  currentExpiresAtIso: string,
  nowMs: number,
): Promise<
  { ok: true; expiresAt: string } | { ok: false; response: Response }
> {
  if (!practitionerInviteShouldRefreshExpiry(currentExpiresAtIso, nowMs)) {
    return { ok: true, expiresAt: currentExpiresAtIso };
  }
  const fresh = practitionerInviteExpiresAtIso();
  const { data: rows, error } = await admin
    .from('practitioner_invites')
    .update({ expires_at: fresh })
    .eq('id', inviteId)
    .is('consumed_at', null)
    .select('expires_at');

  if (error) {
    console.error('practitioner_invites resend extend expires_at', error);
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to refresh the invite expiry. Try again in a moment.',
      }),
    };
  }
  const n = Array.isArray(rows) ? rows.length : 0;
  if (n !== 1) {
    console.warn(
      'practitioner_invites extend expiry matched no pending row',
      inviteId,
    );
    return {
      ok: false,
      response: jsonResponse(409, {
        error:
          'This invite is no longer pending. Send a new invite from your settings if you still need to add this practitioner.',
      }),
    };
  }
  const row = rows[0] as { expires_at?: string };
  if (typeof row.expires_at !== 'string' || row.expires_at === '') {
    console.error(
      'practitioner_invites extend expiry missing expires_at column',
      inviteId,
    );
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to refresh the invite expiry. Try again in a moment.',
      }),
    };
  }
  return { ok: true, expiresAt: row.expires_at };
}

/**
 * Stamps **`practitioner_invites.last_invite_sent_at`** via **`stamp_practitioner_invite_pre_send`**, then
 * sends **`inviteUserByEmail`** with **`data.abstrack_practitioner_invite_id`** (caretaker parity).
 */
async function sendPractitionerInviteEmailAndStamp(
  admin: SupabaseClient,
  options: {
    inviteId: string;
    normalizedTarget: string;
    redirectTo: string;
    inviteExpiresAt: string;
    deletePendingInviteOnMailFailure: boolean;
  },
): Promise<
  { ok: true; inviteExpiresAt: string } | { ok: false; response: Response }
> {
  const {
    inviteId,
    normalizedTarget,
    redirectTo,
    inviteExpiresAt,
    deletePendingInviteOnMailFailure,
  } = options;

  const nowMs = Date.now();
  const stampNowIso = new Date(nowMs).toISOString();
  const throttleCutoffIso = new Date(
    nowMs - PRACTITIONER_INVITE_MIN_RESEND_INTERVAL_MS,
  ).toISOString();

  const { data: stampedRows, error: stampErr } = await admin.rpc(
    'stamp_practitioner_invite_pre_send',
    {
      p_invite_id: inviteId,
      p_stamp: stampNowIso,
      p_throttle_cutoff: throttleCutoffIso,
    },
  );

  if (stampErr) {
    console.error(
      'practitioner_invites last_invite_sent_at (pre-send)',
      stampErr,
    );
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to record the invite send. Try again in a moment.',
      }),
    };
  }

  const stampedCount = Array.isArray(stampedRows) ? stampedRows.length : 0;
  if (stampedCount !== 1) {
    if (stampedCount > 1) {
      console.error(
        'practitioner_invites pre-send stamp unexpected row count',
        inviteId,
        stampedCount,
      );
      return {
        ok: false,
        response: jsonResponse(500, {
          error: 'Unable to verify the invite. Try again in a moment.',
        }),
      };
    }

    const { data: inviteRow, error: inviteReadErr } = await admin
      .from('practitioner_invites')
      .select('id, consumed_at, last_invite_sent_at')
      .eq('id', inviteId)
      .maybeSingle();

    if (inviteReadErr) {
      console.error('practitioner_invites pre-send stale read', inviteReadErr);
      return {
        ok: false,
        response: jsonResponse(500, {
          error: 'Unable to verify the invite. Try again in a moment.',
        }),
      };
    }

    if (!inviteRow) {
      return {
        ok: false,
        response: jsonResponse(404, {
          error:
            'That invite is no longer available. Ask the patient to send a new invite from their settings.',
        }),
      };
    }

    if (inviteRow.consumed_at != null) {
      return {
        ok: false,
        response: jsonResponse(409, {
          error: 'This invite was already completed.',
        }),
      };
    }

    const lostRaceThrottle = practitionerInviteResendTooSoon(
      inviteRow.last_invite_sent_at as string | null | undefined,
      nowMs,
    );
    if (lostRaceThrottle.tooSoon) {
      return {
        ok: false,
        response: jsonResponse(
          429,
          {
            error: 'Please wait before resending the invite.',
            retryAfterSeconds: lostRaceThrottle.retryAfterSec,
          },
          {
            'Retry-After': String(lostRaceThrottle.retryAfterSec),
          },
        ),
      };
    }

    console.warn(
      'practitioner_invites pre-send atomic stamp matched no row (unexpected)',
      inviteId,
    );
    return {
      ok: false,
      response: jsonResponse(409, {
        error:
          'This invite is no longer pending. Ask the patient to send a new invite from their settings.',
      }),
    };
  }

  const { error: invMailErr } = await admin.auth.admin.inviteUserByEmail(
    normalizedTarget,
    {
      data: { abstrack_practitioner_invite_id: inviteId },
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
      if (deletePendingInviteOnMailFailure) {
        const { error: rollbackDelErr } = await admin
          .from('practitioner_invites')
          .delete()
          .eq('id', inviteId);
        if (rollbackDelErr) {
          console.error(
            'practitioner_invites rollback delete (account exists)',
            rollbackDelErr,
          );
          return {
            ok: false,
            response: jsonResponse(500, {
              error:
                'Unable to clean up the invite after that error. Try again or contact support.',
            }),
          };
        }
      }
      return {
        ok: false,
        response: jsonResponse(409, {
          error:
            'An account already exists for that email. Ask them to sign in on the practitioner app, or use “link” after they finish signup.',
        }),
      };
    }
    console.error('inviteUserByEmail practitioner', invMailErr);
    if (deletePendingInviteOnMailFailure) {
      const { error: rollbackDelErr } = await admin
        .from('practitioner_invites')
        .delete()
        .eq('id', inviteId);
      if (rollbackDelErr) {
        console.error(
          'practitioner_invites rollback delete (invite email failed)',
          rollbackDelErr,
        );
        return {
          ok: false,
          response: jsonResponse(500, {
            error:
              'Invite email failed and the pending row could not be removed. Try again or contact support.',
          }),
        };
      }
    }
    return {
      ok: false,
      response: jsonResponse(500, {
        error:
          'Unable to send the invite email right now. Try again in a moment.',
      }),
    };
  }

  return { ok: true, inviteExpiresAt };
}

async function deleteOrphanInvitedPractitionerAuthUserAfterInviteRemoved(
  admin: SupabaseClient,
  inviteId: string,
  inviteeEmailNormalized: string,
): Promise<void> {
  let practitionerUserId: string | null = null;
  try {
    practitionerUserId = await resolveAuthUserIdByEmail(
      admin,
      inviteeEmailNormalized,
    );
  } catch (e) {
    console.warn(
      'practitioner_invite_cancel auth lookup failed (invite row already deleted)',
      inviteId,
      e,
    );
    return;
  }
  if (!practitionerUserId) {
    return;
  }

  const { data: authUserRes, error: getErr } =
    await admin.auth.admin.getUserById(practitionerUserId);
  if (getErr || !authUserRes?.user) {
    console.warn(
      'practitioner_invite_cancel getUser',
      inviteId,
      practitionerUserId,
      getErr,
    );
    return;
  }

  const metaInvite =
    authUserRes.user.user_metadata?.abstrack_practitioner_invite_id;
  if (typeof metaInvite !== 'string' || metaInvite !== inviteId) {
    return;
  }

  const { data: activeGrant, error: grantErr } = await admin
    .from('practitioner_access')
    .select('id')
    .eq('practitioner_user_id', practitionerUserId)
    .is('revoked_at', null)
    .maybeSingle();

  if (grantErr) {
    console.warn(
      'practitioner_invite_cancel practitioner_access lookup',
      inviteId,
      grantErr,
    );
    return;
  }
  if (activeGrant) {
    return;
  }

  const { error: delErr } =
    await admin.auth.admin.deleteUser(practitionerUserId);
  if (delErr) {
    console.warn(
      'practitioner_invite_cancel deleteUser',
      inviteId,
      practitionerUserId,
      delErr,
    );
  }
}

/**
 * Deletes unconsumed practitioner invite rows for a patient (best-effort orphan Auth cleanup).
 *
 * @returns Supabase error when the delete fails; callers must not treat success as committed otherwise.
 */
async function clearPendingPractitionerInvitesForPatient(
  admin: SupabaseClient,
  patientUserId: string,
): Promise<{ error: unknown | null }> {
  const { data: removed, error } = await admin
    .from('practitioner_invites')
    .delete()
    .eq('patient_user_id', patientUserId)
    .is('consumed_at', null)
    .select('id, invitee_email_normalized');

  if (error) {
    return { error };
  }

  for (const row of removed ?? []) {
    const inviteId = row.id as string;
    const emailNorm = row.invitee_email_normalized as string;
    await deleteOrphanInvitedPractitionerAuthUserAfterInviteRemoved(
      admin,
      inviteId,
      emailNorm,
    );
  }

  return { error: null };
}

async function consumePractitionerInviteForFinalize(
  admin: SupabaseClient,
  inviteId: string,
  practitionerUserId: string,
  consumedAtIso: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data, error } = await admin
    .from('practitioner_invites')
    .update({
      consumed_at: consumedAtIso,
      consumed_practitioner_user_id: practitionerUserId,
    })
    .eq('id', inviteId)
    .is('consumed_at', null)
    .select('id');

  if (error) {
    console.error('finalize consume practitioner invite', error);
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to complete the invite. Try again in a moment.',
      }),
    };
  }

  const updatedCount = Array.isArray(data) ? data.length : 0;
  if (updatedCount >= 1) {
    return { ok: true };
  }

  const { data: row, error: refetchErr } = await admin
    .from('practitioner_invites')
    .select('consumed_at, consumed_practitioner_user_id')
    .eq('id', inviteId)
    .maybeSingle();

  if (refetchErr) {
    console.error('finalize consume practitioner invite refetch', refetchErr);
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to complete the invite. Try again in a moment.',
      }),
    };
  }

  if (!row) {
    return {
      ok: false,
      response: jsonResponse(404, {
        error: 'Invite not found or already used.',
      }),
    };
  }

  if (row.consumed_at != null) {
    if (row.consumed_practitioner_user_id === practitionerUserId) {
      return { ok: true };
    }
    return {
      ok: false,
      response: jsonResponse(409, {
        error: 'This invite was already completed.',
      }),
    };
  }

  console.error(
    'finalize consume practitioner invite: update matched no rows but invite still pending',
    inviteId,
  );
  return {
    ok: false,
    response: jsonResponse(500, {
      error: 'Unable to complete the invite. Try again in a moment.',
    }),
  };
}

/**
 * Drops **`abstrack_practitioner_invite_id`** from Auth **`user_metadata`** after finalize succeeds
 * (or idempotent replay) so practitioner clients do not repeat finalize on every load.
 *
 * @param admin Elevated Supabase client.
 * @param userId Practitioner **`auth.users.id`**.
 */
async function clearPractitionerInviteMetadataFromAuthUser(
  admin: SupabaseClient,
  userId: string,
): Promise<void> {
  const { data: authRes, error: getErr } =
    await admin.auth.admin.getUserById(userId);
  if (getErr || !authRes?.user) {
    console.warn(
      'clear practitioner invite metadata: getUserById',
      userId,
      getErr,
    );
    return;
  }
  const current = authRes.user.user_metadata;
  if (
    current == null ||
    typeof current !== 'object' ||
    !Object.hasOwn(current, 'abstrack_practitioner_invite_id')
  ) {
    return;
  }
  const nextMeta: Record<string, unknown> = {
    ...(current as Record<string, unknown>),
  };
  delete nextMeta.abstrack_practitioner_invite_id;
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    user_metadata: nextMeta,
  });
  if (updErr) {
    console.warn(
      'clear practitioner invite metadata: updateUserById',
      userId,
      updErr,
    );
  }
}

async function finalizeConsumeInviteAfterGrantPractitioner(
  admin: SupabaseClient,
  inviteId: string,
  practitionerUserId: string,
  patientUserId: string,
  nowIso: string,
  outcome: 'already_linked' | 'linked',
  rollbackActiveGrantOnConsume404: boolean,
): Promise<Response> {
  const consumed = await consumePractitionerInviteForFinalize(
    admin,
    inviteId,
    practitionerUserId,
    nowIso,
  );
  if (consumed.ok) {
    await clearPractitionerInviteMetadataFromAuthUser(
      admin,
      practitionerUserId,
    );
    return jsonResponse(200, { ok: true, outcome });
  }
  if (consumed.response.status === 404 && rollbackActiveGrantOnConsume404) {
    const { error: rbErr } = await admin
      .from('practitioner_access')
      .update({ revoked_at: nowIso })
      .eq('patient_user_id', patientUserId)
      .eq('practitioner_user_id', practitionerUserId)
      .is('revoked_at', null);
    if (rbErr) {
      console.error(
        'finalize practitioner rollback grant after consume 404',
        inviteId,
        rbErr,
      );
    } else {
      console.warn(
        'finalize practitioner: rolled back grant after invite missing (consume 404)',
        inviteId,
      );
    }
    return consumed.response;
  }
  if (consumed.response.status === 404 && !rollbackActiveGrantOnConsume404) {
    const { data: link, error: linkErr } = await admin
      .from('practitioner_access')
      .select('id, revoked_at')
      .eq('patient_user_id', patientUserId)
      .eq('practitioner_user_id', practitionerUserId)
      .maybeSingle();
    if (!linkErr && link && link.revoked_at == null) {
      console.warn(
        'finalize practitioner: invite row missing; idempotent success (no grant rollback)',
        inviteId,
      );
      await clearPractitionerInviteMetadataFromAuthUser(
        admin,
        practitionerUserId,
      );
      return jsonResponse(200, { ok: true, outcome });
    }
  }
  return consumed.response;
}

async function handleFinalizePractitionerInvite(
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

  const metaInviteId = user.user_metadata?.abstrack_practitioner_invite_id;
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
    .from('practitioner_invites')
    .select(
      'id, patient_user_id, invitee_email_normalized, expires_at, consumed_at, consumed_practitioner_user_id',
    )
    .eq('id', inviteId)
    .maybeSingle();

  if (invErr) {
    console.error('finalize practitioner invite lookup', invErr);
    return jsonResponse(500, {
      error: 'Unable to load the invite. Try again in a moment.',
    });
  }
  if (!invite) {
    return jsonResponse(404, {
      error: 'Invite not found or already used.',
    });
  }

  if (invite.consumed_at != null) {
    if (invite.consumed_practitioner_user_id === user.id) {
      const patientIdDone = invite.patient_user_id as string;
      const { data: pairActive, error: pairDoneErr } = await admin
        .from('practitioner_access')
        .select('id')
        .eq('patient_user_id', patientIdDone)
        .eq('practitioner_user_id', user.id)
        .is('revoked_at', null)
        .maybeSingle();
      if (pairDoneErr) {
        console.error(
          'finalize practitioner idempotent consumed pair lookup',
          pairDoneErr,
        );
        return jsonResponse(500, {
          error: 'Unable to verify practitioner access. Try again in a moment.',
        });
      }
      await clearPractitionerInviteMetadataFromAuthUser(admin, user.id);
      return jsonResponse(200, {
        ok: true,
        outcome: pairActive ? 'already_linked' : 'linked',
      });
    }
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

  const profEnsure = await ensurePractitionerProfileForInvitedUser(
    admin,
    user.id,
  );
  if (!profEnsure.ok) {
    return profEnsure.response;
  }

  const { data: prProfile, error: pErr } = await admin
    .from('profiles')
    .select('app_role')
    .eq('id', user.id)
    .maybeSingle();

  if (pErr) {
    return jsonResponse(500, { error: 'Unable to verify your profile.' });
  }
  if (!prProfile || prProfile.app_role !== 'practitioner') {
    return jsonResponse(403, {
      error:
        'Create your ABStrack profile as a practitioner first, then return to finish this invite.',
    });
  }

  const patientId = invite.patient_user_id as string;
  if (patientId === user.id) {
    return jsonResponse(400, { error: 'Invalid invite.' });
  }

  const { data: existingPair, error: pairError } = await admin
    .from('practitioner_access')
    .select('id, revoked_at')
    .eq('patient_user_id', patientId)
    .eq('practitioner_user_id', user.id)
    .maybeSingle();

  if (pairError) {
    console.error('finalize practitioner pair lookup', pairError);
    return jsonResponse(500, {
      error: 'Unable to verify existing practitioner access.',
    });
  }

  const nowIso = new Date().toISOString();

  if (existingPair?.revoked_at == null && existingPair) {
    return await finalizeConsumeInviteAfterGrantPractitioner(
      admin,
      inviteId,
      user.id,
      patientId,
      nowIso,
      'already_linked',
      false,
    );
  }

  if (existingPair && existingPair.revoked_at != null) {
    const { error: updError } = await admin
      .from('practitioner_access')
      .update({ revoked_at: null })
      .eq('id', existingPair.id);

    if (updError) {
      if (isPostgresUniqueViolation(updError)) {
        const { data: activeGrant, error: activeErr } = await admin
          .from('practitioner_access')
          .select('practitioner_user_id')
          .eq('patient_user_id', patientId)
          .eq('practitioner_user_id', user.id)
          .is('revoked_at', null)
          .maybeSingle();
        if (!activeErr && activeGrant?.practitioner_user_id === user.id) {
          return await finalizeConsumeInviteAfterGrantPractitioner(
            admin,
            inviteId,
            user.id,
            patientId,
            nowIso,
            'linked',
            false,
          );
        }
        console.error('finalize practitioner reactivate unique race', updError);
        return jsonResponse(500, {
          error: 'Unable to restore practitioner access.',
        });
      }
      console.error('finalize practitioner reactivate', updError);
      return jsonResponse(500, {
        error: 'Unable to restore practitioner access.',
      });
    }
  } else {
    const { error: insError } = await admin.from('practitioner_access').insert({
      patient_user_id: patientId,
      practitioner_user_id: user.id,
    });

    if (insError) {
      if (isPostgresUniqueViolation(insError)) {
        const { data: dup, error: dupErr } = await admin
          .from('practitioner_access')
          .select('id, revoked_at')
          .eq('patient_user_id', patientId)
          .eq('practitioner_user_id', user.id)
          .maybeSingle();
        if (!dupErr && dup && dup.revoked_at == null) {
          return await finalizeConsumeInviteAfterGrantPractitioner(
            admin,
            inviteId,
            user.id,
            patientId,
            nowIso,
            'linked',
            false,
          );
        }
        if (!dupErr && dup && dup.revoked_at != null) {
          const { error: reErr } = await admin
            .from('practitioner_access')
            .update({ revoked_at: null })
            .eq('id', dup.id);
          if (reErr) {
            console.error(
              'finalize practitioner insert 23505 reactivate',
              reErr,
            );
            return jsonResponse(500, {
              error: 'Unable to restore practitioner access.',
            });
          }
          return await finalizeConsumeInviteAfterGrantPractitioner(
            admin,
            inviteId,
            user.id,
            patientId,
            nowIso,
            'linked',
            false,
          );
        }
        console.error('finalize practitioner insert 23505', insError);
        return jsonResponse(500, {
          error: 'Unable to grant practitioner access.',
        });
      }
      console.error('finalize practitioner insert', insError);
      return jsonResponse(500, {
        error: 'Unable to grant practitioner access.',
      });
    }
  }

  const grantWasFreshInsert = !(
    existingPair && existingPair.revoked_at != null
  );
  return await finalizeConsumeInviteAfterGrantPractitioner(
    admin,
    inviteId,
    user.id,
    patientId,
    nowIso,
    'linked',
    grantWasFreshInsert,
  );
}

function normalizeInviteWebOriginForRedirect(raw: string): string | null {
  const base = raw.trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }
  if (!/^https?:\/\//i.test(base)) {
    console.error(
      'ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN must be an absolute http(s) URL (e.g. https://practitioner.example.com).',
    );
    return null;
  }
  try {
    return new URL(base).origin;
  } catch {
    console.error(
      'Invalid ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN after trim.',
    );
    return null;
  }
}

/**
 * Supabase Auth **`redirectTo`** for practitioner invite emails (practitioner web app PKCE callback).
 *
 * @returns Non-empty redirect URL, or **`null`** when neither secret yields a valid value.
 */
function resolvePractitionerInviteRedirectTo(): string | null {
  const explicitRedirect = (
    Deno.env.get('ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO') ?? ''
  ).trim();
  const inviteWebOrigin = explicitRedirect
    ? null
    : normalizeInviteWebOriginForRedirect(
        Deno.env.get('ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN') ?? '',
      );
  const redirectTo =
    explicitRedirect ||
    (inviteWebOrigin
      ? `${inviteWebOrigin}/auth/callback?next=${encodeURIComponent('/')}`
      : '');
  return redirectTo.length > 0 ? redirectTo : null;
}

async function resolveAuthUserIdByEmail(
  admin: SupabaseClient,
  rawEmail: string,
): Promise<string | null> {
  const target = normalizeEmailForLookup(rawEmail);
  if (!target) {
    return null;
  }
  const { data, error } = await admin.rpc(
    'resolve_auth_user_id_by_normalized_email',
    { p_normalized: target },
  );
  if (error) {
    throw error;
  }
  if (typeof data === 'string' && data.length > 0) {
    return data;
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

/**
 * Detects GoTrue **`inviteUserByEmail`** errors when the email already has an Auth user
 * (“already registered”, “exists”, etc.).
 *
 * @param message - `AuthError.message` or empty.
 */
function isAuthInviteEmailAlreadyInUseMessage(message: string): boolean {
  const lower = message.trim().toLowerCase();
  if (lower.length === 0) {
    return false;
  }
  return (
    lower.includes('already') ||
    lower.includes('registered') ||
    lower.includes('exists')
  );
}

/**
 * **Link-existing path:** requires a **`profiles`** row with **`app_role = practitioner`**.
 * Does **not** insert a profile (avoids turning an Auth user with a missing or ambiguous profile
 * into a practitioner). Call only when the user already exists in Auth by email.
 *
 * @returns **422** when the profile is missing or the role is not practitioner.
 */
async function requirePractitionerProfileForLink(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data: prof, error: readErr } = await admin
    .from('profiles')
    .select('app_role')
    .eq('id', userId)
    .maybeSingle();

  if (readErr) {
    console.error('profiles read practitioner link', readErr);
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to verify practitioner profile.',
      }),
    };
  }

  if (prof == null) {
    return {
      ok: false,
      response: jsonResponse(422, {
        error:
          'That account has no ABStrack profile yet, or it is not registered as a practitioner. Ask them to complete practitioner sign-up first, then try linking this email again.',
      }),
    };
  }

  if (prof.app_role !== 'practitioner') {
    return {
      ok: false,
      response: jsonResponse(422, {
        error:
          'That account is not registered as a healthcare practitioner in ABStrack. Use an email tied to the practitioner app, not a patient or caretaker account.',
      }),
    };
  }

  return { ok: true };
}

/**
 * **Post-invite path only:** after **`inviteUserByEmail`**, create **`profiles`** with
 * **`app_role = practitioner`** when missing, or succeed when already practitioner.
 * Never use for link-by-email of an arbitrary existing Auth user.
 *
 * @returns Error response when an existing profile has a different role.
 */
async function ensurePractitionerProfileForInvitedUser(
  admin: SupabaseClient,
  userId: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data: prof, error: readErr } = await admin
    .from('profiles')
    .select('app_role')
    .eq('id', userId)
    .maybeSingle();

  if (readErr) {
    console.error('profiles read practitioner invite', readErr);
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to verify practitioner profile.',
      }),
    };
  }

  if (prof?.app_role != null && prof.app_role !== 'practitioner') {
    return {
      ok: false,
      response: jsonResponse(422, {
        error:
          'That account is not registered as a healthcare practitioner in ABStrack. Use an email tied to the practitioner app, not a patient or caretaker account.',
      }),
    };
  }

  if (prof?.app_role === 'practitioner') {
    return { ok: true };
  }

  const { error: insErr } = await admin.from('profiles').insert({
    id: userId,
    app_role: 'practitioner',
  });

  if (insErr) {
    if (isPostgresUniqueViolation(insErr)) {
      const { data: again, error: againErr } = await admin
        .from('profiles')
        .select('app_role')
        .eq('id', userId)
        .maybeSingle();
      if (againErr || again?.app_role !== 'practitioner') {
        return {
          ok: false,
          response: jsonResponse(409, {
            error:
              'Could not finish practitioner profile setup. Ask them to try signing in once, then send the invite again.',
          }),
        };
      }
      return { ok: true };
    }
    console.error('profiles insert practitioner', insErr);
    return {
      ok: false,
      response: jsonResponse(500, {
        error: 'Unable to create practitioner profile.',
      }),
    };
  }

  return { ok: true };
}

type GrantOutcome =
  | { kind: 'active' }
  | { kind: 'reactivated' }
  | { kind: 'inserted' }
  | { kind: 'error'; response: Response };

/**
 * Inserts or reactivates **`practitioner_access`** for **`(patientUserId, practitionerUserId)`**.
 */
async function upsertActivePractitionerGrant(
  admin: SupabaseClient,
  patientUserId: string,
  practitionerUserId: string,
): Promise<GrantOutcome> {
  const { data: row, error: selErr } = await admin
    .from('practitioner_access')
    .select('id, revoked_at')
    .eq('patient_user_id', patientUserId)
    .eq('practitioner_user_id', practitionerUserId)
    .maybeSingle();

  if (selErr) {
    console.error('practitioner_access pair lookup', selErr);
    return {
      kind: 'error',
      response: jsonResponse(500, {
        error: 'Unable to verify practitioner access.',
      }),
    };
  }

  if (row?.revoked_at == null && row) {
    return { kind: 'active' };
  }

  if (row && row.revoked_at != null) {
    const { error: updErr } = await admin
      .from('practitioner_access')
      .update({ revoked_at: null })
      .eq('id', row.id);

    if (updErr) {
      console.error('practitioner_access reactivate', updErr);
      return {
        kind: 'error',
        response: jsonResponse(500, {
          error: 'Unable to restore practitioner access.',
        }),
      };
    }
    return { kind: 'reactivated' };
  }

  const { error: insErr } = await admin.from('practitioner_access').insert({
    patient_user_id: patientUserId,
    practitioner_user_id: practitionerUserId,
  });

  if (insErr) {
    if (isPostgresUniqueViolation(insErr)) {
      const { data: dup, error: dupErr } = await admin
        .from('practitioner_access')
        .select('id, revoked_at')
        .eq('patient_user_id', patientUserId)
        .eq('practitioner_user_id', practitionerUserId)
        .maybeSingle();
      if (!dupErr && dup && dup.revoked_at == null) {
        return { kind: 'active' };
      }
      if (!dupErr && dup && dup.revoked_at != null) {
        const { error: reErr } = await admin
          .from('practitioner_access')
          .update({ revoked_at: null })
          .eq('id', dup.id);
        if (reErr) {
          console.error('practitioner_access reactivate race', reErr);
          return {
            kind: 'error',
            response: jsonResponse(500, {
              error: 'Unable to restore practitioner access.',
            }),
          };
        }
        return { kind: 'reactivated' };
      }
    }
    console.error('practitioner_access insert', insErr);
    return {
      kind: 'error',
      response: jsonResponse(500, {
        error: 'Unable to grant practitioner access.',
      }),
    };
  }

  return { kind: 'inserted' };
}

async function linkExistingPractitionerByUserId(
  admin: SupabaseClient,
  patientUserId: string,
  practitionerUserId: string,
): Promise<Response> {
  const prof = await requirePractitionerProfileForLink(
    admin,
    practitionerUserId,
  );
  if (!prof.ok) {
    return prof.response;
  }

  const grant = await upsertActivePractitionerGrant(
    admin,
    patientUserId,
    practitionerUserId,
  );
  if (grant.kind === 'error') {
    return grant.response;
  }

  const { error: clearPendingErr } =
    await clearPendingPractitionerInvitesForPatient(admin, patientUserId);
  if (clearPendingErr) {
    console.error(
      'link practitioner clear pending (best-effort; grant write succeeded)',
      clearPendingErr,
    );
  }

  if (grant.kind === 'active') {
    return jsonResponse(200, {
      ok: true,
      outcome: 'already_linked',
      ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
    });
  }

  return jsonResponse(200, {
    ok: true,
    outcome: 'linked',
    ...(grant.kind === 'reactivated' ? { reactivated: true } : {}),
    ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (!['GET', 'POST'].includes(req.method)) {
    return jsonResponse(
      405,
      { error: 'method_not_allowed' },
      { Allow: ALLOW_METHODS },
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
  }

  if (
    req.method === 'POST' &&
    postBody &&
    (postBody.finalizePractitionerInvite === true ||
      postBody.finalizePractitionerInvite === 'true')
  ) {
    const inviteIdRaw = postBody.inviteId;
    if (typeof inviteIdRaw !== 'string' || !inviteIdRaw.trim()) {
      return jsonResponse(400, { error: 'inviteId is required.' });
    }
    return await handleFinalizePractitionerInvite(
      admin,
      user,
      inviteIdRaw.trim(),
    );
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
        'Only patient accounts can manage practitioner access from this endpoint.',
    });
  }

  if (req.method === 'GET') {
    const { data: rows, error: grantError } = await admin
      .from('practitioner_access')
      .select('id, practitioner_user_id, created_at')
      .eq('patient_user_id', user.id)
      .is('revoked_at', null)
      .order('created_at', { ascending: true });

    if (grantError) {
      console.error('practitioner_access GET', grantError);
      return jsonResponse(500, {
        error: 'Unable to load practitioner access right now.',
      });
    }

    const rowList = rows ?? [];

    let grants: Array<{
      id: string;
      practitionerUserId: string;
      practitionerEmail: string | null;
      practitionerDisplayName: string | null;
      createdAt: string;
    }> = [];

    if (rowList.length > 0) {
      const practitionerIds = [
        ...new Set(rowList.map((r) => r.practitioner_user_id as string)),
      ];

      const [
        { data: profileRows, error: profilesErr },
        { data: emailRows, error: emailsErr },
      ] = await Promise.all([
        admin
          .from('profiles')
          .select('id, display_name')
          .in('id', practitionerIds),
        admin.rpc('list_practitioner_auth_emails_for_patient_grants', {
          p_patient_user_id: user.id,
          p_practitioner_user_ids: practitionerIds,
        }),
      ]);

      if (profilesErr) {
        console.error('profiles batch GET practitioner grants', profilesErr);
        return jsonResponse(500, {
          error: 'Unable to load practitioner access right now.',
        });
      }
      if (emailsErr) {
        console.error(
          'list_practitioner_auth_emails_for_patient_grants',
          emailsErr,
        );
        return jsonResponse(500, {
          error: 'Unable to load practitioner access right now.',
        });
      }

      const displayById = new Map<string, string | null>();
      for (const p of profileRows ?? []) {
        const rowId = p.id as string | undefined;
        if (rowId != null && rowId !== '') {
          displayById.set(rowId, (p.display_name as string | null) ?? null);
        }
      }

      const emailById = new Map<string, string | null>();
      const emailList = (emailRows ?? []) as Array<{
        practitioner_user_id?: string;
        email?: string | null;
      }>;
      for (const row of emailList) {
        const pid = row.practitioner_user_id;
        if (typeof pid === 'string' && pid !== '') {
          emailById.set(pid, row.email ?? null);
        }
      }

      grants = rowList.map((r) => {
        const pid = r.practitioner_user_id as string;
        return {
          id: r.id as string,
          practitionerUserId: pid,
          practitionerEmail: emailById.get(pid) ?? null,
          practitionerDisplayName: displayById.get(pid) ?? null,
          createdAt: r.created_at as string,
        };
      });
    }

    const { data: pending, error: pendErr } = await admin
      .from('practitioner_invites')
      .select(
        'invitee_email_normalized, expires_at, last_invite_sent_at, created_at',
      )
      .eq('patient_user_id', user.id)
      .is('consumed_at', null)
      .maybeSingle();

    if (pendErr) {
      console.error('practitioner_invites GET', pendErr);
      return jsonResponse(500, {
        error: 'Unable to load practitioner access right now.',
      });
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

    return jsonResponse(200, { grants, pendingInvite });
  }

  // POST
  if (!postBody) {
    return jsonResponse(400, { error: 'Expected JSON body.' });
  }

  const revokeIdRaw = postBody.revokePractitionerUserId;
  if (revokeIdRaw !== undefined && revokeIdRaw !== null) {
    if (typeof revokeIdRaw !== 'string' || !UUID_RE.test(revokeIdRaw.trim())) {
      return jsonResponse(400, {
        error: 'revokePractitionerUserId must be a valid UUID string.',
      });
    }
    const revokeId = revokeIdRaw.trim();

    const { data: activeRow, error: revokeSelErr } = await admin
      .from('practitioner_access')
      .select('id')
      .eq('patient_user_id', user.id)
      .eq('practitioner_user_id', revokeId)
      .is('revoked_at', null)
      .maybeSingle();

    if (revokeSelErr) {
      console.error('practitioner_access revoke lookup', revokeSelErr);
      return jsonResponse(500, {
        error: 'Unable to revoke practitioner access right now.',
      });
    }

    if (!activeRow) {
      return jsonResponse(404, {
        error: 'No active practitioner grant found for that account.',
      });
    }

    const { error: revokeErr } = await admin
      .from('practitioner_access')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', activeRow.id)
      .is('revoked_at', null);

    if (revokeErr) {
      console.error('practitioner_access revoke', revokeErr);
      return jsonResponse(500, {
        error: 'Unable to revoke practitioner access right now.',
      });
    }

    return jsonResponse(200, {
      ok: true,
      outcome: 'revoked',
      /** PRD: revocation stops future reads; it does not erase data already viewed. */
      note: 'Future access for this practitioner is removed. Data they may have already seen is not erased.',
    });
  }

  const cancelPending =
    postBody.cancelPendingPractitionerInvite === true ||
    postBody.cancelPendingPractitionerInvite === 'true';
  if (cancelPending) {
    const { error: clearErr } = await clearPendingPractitionerInvitesForPatient(
      admin,
      user.id,
    );
    if (clearErr) {
      console.error('practitioner_invites cancel clear', clearErr);
      return jsonResponse(500, {
        error: 'Unable to cancel the pending invite. Try again in a moment.',
      });
    }
    return jsonResponse(200, {
      ok: true,
      outcome: 'pending_invite_cancelled',
    });
  }

  const rawEmail = postBody.practitionerEmail;
  if (typeof rawEmail !== 'string' || !normalizeEmailForLookup(rawEmail)) {
    return jsonResponse(400, {
      error: 'Enter the practitioner’s email address.',
    });
  }

  const normalizedTarget = normalizeEmailForLookup(rawEmail);
  if (!isPlausiblePractitionerInviteEmail(normalizedTarget)) {
    return jsonResponse(400, {
      error:
        'Enter a valid email address for the practitioner (for example, name@clinic.example).',
    });
  }

  const resend =
    postBody.resendPractitionerInvite === true ||
    postBody.resendPractitionerInvite === 'true';

  if (resend) {
    const redirectToResend = resolvePractitionerInviteRedirectTo();
    if (!redirectToResend) {
      console.error(
        'Missing ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO or ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN.',
      );
      return jsonResponse(500, { error: 'server_misconfigured' });
    }

    const { data: pendingResend, error: pendResendErr } = await admin
      .from('practitioner_invites')
      .select('id, invitee_email_normalized, expires_at, last_invite_sent_at')
      .eq('patient_user_id', user.id)
      .is('consumed_at', null)
      .maybeSingle();

    if (pendResendErr) {
      console.error('practitioner_invites resend pending read', pendResendErr);
      return jsonResponse(500, {
        error: 'Unable to verify pending invite. Try again in a moment.',
      });
    }

    if (
      pendingResend &&
      (pendingResend.invitee_email_normalized as string) === normalizedTarget
    ) {
      const nowMsPending = Date.now();

      const pendingThrottle = practitionerInviteResendTooSoon(
        pendingResend.last_invite_sent_at as string | null | undefined,
        nowMsPending,
      );
      if (pendingThrottle.tooSoon) {
        return jsonResponse(
          429,
          {
            error: 'Please wait before resending the invite.',
            retryAfterSeconds: pendingThrottle.retryAfterSec,
          },
          {
            'Retry-After': String(pendingThrottle.retryAfterSec),
          },
        );
      }

      const refreshedPending = await refreshPractitionerInviteExpiryIfNeeded(
        admin,
        pendingResend.id as string,
        pendingResend.expires_at as string,
        nowMsPending,
      );
      if (!refreshedPending.ok) {
        return refreshedPending.response;
      }

      const mailPending = await sendPractitionerInviteEmailAndStamp(admin, {
        inviteId: pendingResend.id as string,
        normalizedTarget,
        redirectTo: redirectToResend,
        inviteExpiresAt: refreshedPending.expiresAt,
        deletePendingInviteOnMailFailure: false,
      });
      if (!mailPending.ok) {
        return mailPending.response;
      }

      return jsonResponse(200, {
        ok: true,
        outcome: 'invite_resent',
        inviteExpiresAt: mailPending.inviteExpiresAt,
      });
    }

    let practitionerUserId: string | null = null;
    try {
      practitionerUserId = await resolveAuthUserIdByEmail(admin, rawEmail);
    } catch (e) {
      console.error('resolveAuthUserIdByEmail resend', e);
      return jsonResponse(500, {
        error: 'Unable to look up that email right now.',
      });
    }
    if (!practitionerUserId) {
      return jsonResponse(404, {
        error:
          'No pending invite or active practitioner grant for that email. Send a new invite first.',
      });
    }

    const { data: activeGrant, error: gErr } = await admin
      .from('practitioner_access')
      .select('id')
      .eq('patient_user_id', user.id)
      .eq('practitioner_user_id', practitionerUserId)
      .is('revoked_at', null)
      .maybeSingle();

    if (gErr) {
      console.error('practitioner_access resend lookup', gErr);
      return jsonResponse(500, {
        error: 'Unable to verify practitioner access.',
      });
    }
    if (!activeGrant) {
      return jsonResponse(404, {
        error:
          'No pending invite or active practitioner grant for that email. Send a new invite first.',
      });
    }

    const nowMsResend = Date.now();
    const stampResend = await stampPractitionerAccessInviteEmailSentAtOr429(
      admin,
      user.id,
      practitionerUserId,
      nowMsResend,
    );
    if (!stampResend.ok) {
      return stampResend.response;
    }

    const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(
      normalizedTarget,
      { redirectTo: redirectToResend },
    );
    if (mailErr) {
      const mailMsg = (mailErr as { message?: string }).message ?? '';
      if (isAuthInviteEmailAlreadyInUseMessage(mailMsg)) {
        return jsonResponse(200, {
          ok: true,
          outcome: 'invite_not_needed',
          message:
            'That address already has a practitioner account. They can sign in on the practitioner app with their email and password; no new invite email was sent.',
        });
      }
      console.error('inviteUserByEmail resend', mailErr);
      return jsonResponse(500, {
        error:
          'Unable to resend the invite email right now. Try again in a moment.',
        errorCode: 'invite_resend_mail_failed',
      });
    }

    return jsonResponse(200, { ok: true, outcome: 'invite_resent' });
  }

  if (normalizedTarget === normalizeEmailForLookup(user.email ?? '')) {
    return jsonResponse(400, {
      error: 'You cannot invite your own email as your practitioner.',
    });
  }

  let practitionerUserId: string | null = null;
  try {
    practitionerUserId = await resolveAuthUserIdByEmail(admin, rawEmail);
  } catch (e) {
    console.error('resolveAuthUserIdByEmail', e);
    return jsonResponse(500, {
      error: 'Unable to look up that email right now.',
    });
  }

  if (practitionerUserId === user.id) {
    return jsonResponse(400, {
      error: 'You cannot link your own account as practitioner.',
    });
  }

  if (practitionerUserId) {
    return await linkExistingPractitionerByUserId(
      admin,
      user.id,
      practitionerUserId,
    );
  }

  // No Auth user yet — pending invite row + invite email (grant is created when the practitioner finalizes).
  const redirectTo = resolvePractitionerInviteRedirectTo();
  if (!redirectTo) {
    console.error(
      'Missing ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO or ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN.',
    );
    return jsonResponse(500, { error: 'server_misconfigured' });
  }

  const { error: clearBeforeInviteErr } =
    await clearPendingPractitionerInvitesForPatient(admin, user.id);
  if (clearBeforeInviteErr) {
    console.error('invite practitioner clear pending', clearBeforeInviteErr);
    return jsonResponse(500, {
      error: 'Unable to clear previous pending invite. Try again in a moment.',
    });
  }

  const newExpiresAt = practitionerInviteExpiresAtIso();
  const { data: invRow, error: insInvErr } = await admin
    .from('practitioner_invites')
    .insert({
      patient_user_id: user.id,
      invitee_email_normalized: normalizedTarget,
      expires_at: newExpiresAt,
    })
    .select('id')
    .single();

  let inviteId: string;
  let inviteExpiresAt: string;

  if (insInvErr) {
    if (isPostgresUniqueViolation(insInvErr)) {
      const { data: pending, error: pendSelErr } = await admin
        .from('practitioner_invites')
        .select('id, invitee_email_normalized, expires_at, last_invite_sent_at')
        .eq('patient_user_id', user.id)
        .is('consumed_at', null)
        .maybeSingle();

      if (pendSelErr || !pending?.id) {
        console.error(
          'practitioner_invites insert race recover',
          pendSelErr,
          insInvErr,
        );
        return jsonResponse(500, {
          error: 'Unable to create practitioner invite.',
        });
      }

      if ((pending.invitee_email_normalized as string) !== normalizedTarget) {
        return jsonResponse(409, {
          error:
            'A pending invite is already in progress for a different email. Cancel the pending invite first.',
        });
      }

      const raceThrottle = practitionerInviteResendTooSoon(
        pending.last_invite_sent_at as string | null | undefined,
        Date.now(),
      );
      if (raceThrottle.tooSoon) {
        return jsonResponse(
          429,
          {
            error: 'Please wait before resending the invite.',
            retryAfterSeconds: raceThrottle.retryAfterSec,
          },
          {
            'Retry-After': String(raceThrottle.retryAfterSec),
          },
        );
      }

      inviteId = pending.id as string;
      const refreshedRace = await refreshPractitionerInviteExpiryIfNeeded(
        admin,
        inviteId,
        pending.expires_at as string,
        Date.now(),
      );
      if (!refreshedRace.ok) {
        return refreshedRace.response;
      }
      inviteExpiresAt = refreshedRace.expiresAt;
    } else {
      console.error('practitioner_invites insert', insInvErr);
      return jsonResponse(500, {
        error: 'Unable to create practitioner invite.',
      });
    }
  } else {
    if (!invRow?.id) {
      console.error('practitioner_invites insert missing id', insInvErr);
      return jsonResponse(500, {
        error: 'Unable to create practitioner invite.',
      });
    }
    inviteId = invRow.id as string;
    inviteExpiresAt = newExpiresAt;
  }

  const mailNew = await sendPractitionerInviteEmailAndStamp(admin, {
    inviteId,
    normalizedTarget,
    redirectTo,
    inviteExpiresAt,
    deletePendingInviteOnMailFailure: true,
  });
  if (!mailNew.ok) {
    return mailNew.response;
  }

  return jsonResponse(200, {
    ok: true,
    outcome: 'invite_sent',
    inviteExpiresAt: mailNew.inviteExpiresAt,
  });
});
