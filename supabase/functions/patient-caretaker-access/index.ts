/**
 * Patient caretaker grants (`caretaker_access`) and **email invites** (`caretaker_invites`).
 * Verified session + elevated Supabase client (default secret key from `SUPABASE_SECRET_KEYS`).
 * Table writes use **service_role**; RLS includes explicit `TO service_role` policies in
 * `supabase/migrations/20260510120000_caretaker_invites.sql` (with `caretaker_invites`) so inserts
 * succeed when that role is subject to RLS, matching the `access_log` pattern.
 * User web + mobile call `…/functions/v1/patient-caretaker-access` with user JWT + `apikey` (publishable).
 *
 * HTTP:
 * - **GET** — patient: active grant + pending invite (if any).
 * - **POST** — patient: `{ caretakerEmail }` send invite or link existing caretaker; `{ cancelPendingCaretakerInvite: true }` cancel pending invite (and best-effort delete the invitee Auth user when they never linked—see `clearPendingInvitesForPatient`); caretaker: `{ finalizeCaretakerInvite: true, inviteId }` after accepting email invite (**200** retry-safe when that invite is already consumed by this caretaker).
 * - **DELETE** — patient: revoke active caretaker grant (clears pending invites too). Returns
 *   **200** with optional **`pendingInviteCleanupFailed: true`** when the grant revoke committed
 *   but best-effort pending-invite cleanup failed.
 * - **POST patient link (200 `linked` / `already_linked`):** body may include **`pendingInviteCleanupFailed: true`** when **`caretaker_access`** is already committed but deleting **`caretaker_invites`** best-effort failed—clients should still treat the link as success.
 *
 * **Invite email:** `auth.admin.inviteUserByEmail` `redirectTo` is **`ABSTRACK_CARETAKER_INVITE_REDIRECT_TO`** when set (trimmed; e.g. `abstrack:///caretaker-invite` for Expo). Otherwise falls back to **`{origin}/auth/callback?next=/caretaker/join`** where `origin` is parsed from **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`** (trimmed, trailing slash removed, must be absolute **http** or **https**). Values must appear in Supabase Auth **Redirect URLs**. Resends for the same patient + invitee email are limited to once per **`CARETAKER_INVITE_MIN_RESEND_INTERVAL_MS`** after **`last_invite_sent_at`**, which is written **before** the Auth invite call so throttle state still applies if the email succeeds but the handler would otherwise error (**429** + **`Retry-After`**).
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

/** Minimum time between successful caretaker invite emails for the same patient + email (ms). */
const CARETAKER_INVITE_MIN_RESEND_INTERVAL_MS = 90_000;

/**
 * @param lastInviteSentAt - `caretaker_invites.last_invite_sent_at` from the last recorded send attempt (stamped before Auth mail).
 * @param nowMs - Current epoch milliseconds.
 */
function caretakerInviteResendTooSoon(
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
  if (elapsed >= CARETAKER_INVITE_MIN_RESEND_INTERVAL_MS) {
    return { tooSoon: false };
  }
  return {
    tooSoon: true,
    retryAfterSec: Math.max(
      1,
      Math.ceil((CARETAKER_INVITE_MIN_RESEND_INTERVAL_MS - elapsed) / 1000),
    ),
  };
}

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
 * Minimal shape check for **`caretakerEmail`** before Auth Admin / DB writes so malformed input
 * returns **400** instead of failing later with **500** + rollback. Not a full RFC 5322 validator.
 *
 * @param normalized - Output of {@link normalizeEmailForLookup}.
 * @returns `true` when the string looks like a deliverable email (local@domain with a dot in domain).
 */
function isPlausibleCaretakerInviteEmail(normalized: string): boolean {
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

function inviteExpiresAtIso(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + INVITE_VALID_DAYS);
  return d.toISOString();
}

/**
 * When the wall‑clock time until **`expires_at`** falls below this threshold, a resend refreshes
 * **`caretaker_invites.expires_at`** so finalize does not immediately return **410** on an old row.
 */
const CARETAKER_INVITE_RESEND_REFRESH_EXPIRY_REMAINING_MS = 48 * 60 * 60 * 1000;

/**
 * @param expiresAtIso - `caretaker_invites.expires_at`.
 * @param nowMs - Current epoch milliseconds.
 * @returns `true` when expired, unparseable, or within the refresh window of expiry.
 */
function caretakerInviteShouldRefreshExpiry(
  expiresAtIso: string,
  nowMs: number,
): boolean {
  const t = Date.parse(expiresAtIso);
  if (!Number.isFinite(t)) {
    return true;
  }
  return t - nowMs < CARETAKER_INVITE_RESEND_REFRESH_EXPIRY_REMAINING_MS;
}

/**
 * Extends **`expires_at`** to a new **`INVITE_VALID_DAYS`** window when the pending row is expired
 * or near expiry (see {@link caretakerInviteShouldRefreshExpiry}).
 */
async function refreshCaretakerInviteExpiryIfNeeded(
  admin: SupabaseClient,
  inviteId: string,
  currentExpiresAtIso: string,
  nowMs: number,
): Promise<
  { ok: true; expiresAt: string } | { ok: false; response: Response }
> {
  if (!caretakerInviteShouldRefreshExpiry(currentExpiresAtIso, nowMs)) {
    return { ok: true, expiresAt: currentExpiresAtIso };
  }
  const fresh = inviteExpiresAtIso();
  const { data: rows, error } = await admin
    .from('caretaker_invites')
    .update({ expires_at: fresh })
    .eq('id', inviteId)
    .is('consumed_at', null)
    .select('expires_at');

  if (error) {
    console.error('caretaker_invites resend extend expires_at', error);
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
      'caretaker_invites extend expiry matched no pending row',
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
  const row = rows[0] as { expires_at?: string };
  if (typeof row.expires_at !== 'string' || row.expires_at === '') {
    console.error(
      'caretaker_invites extend expiry missing expires_at column',
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
 * Normalizes **`ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN`**: trims, strips **all** trailing slashes so
 * pasted values like `https://app.example.com///` do not yield `…//auth/callback` (redirect
 * allow-list mismatch). Parses as an absolute **http** or **https** URL and returns **`URL.origin`**
 * (no path) for building `/auth/callback`. Returns `null` when unset, invalid, or not http(s).
 */
function normalizeInviteWebOriginForRedirect(raw: string): string | null {
  const base = raw.trim().replace(/\/+$/, '');
  if (!base) {
    return null;
  }
  if (!/^https?:\/\//i.test(base)) {
    console.error(
      'ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN must be an absolute http(s) URL (e.g. https://app.example.com).',
    );
    return null;
  }
  try {
    return new URL(base).origin;
  } catch {
    console.error('Invalid ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN after trim.');
    return null;
  }
}

/**
 * Builds Supabase Auth **`redirectTo`** for caretaker invite emails from Edge secrets.
 *
 * @returns Non-empty redirect URL, or **`null`** when neither secret yields a valid value.
 */
function resolveCaretakerInviteRedirectTo(): string | null {
  const explicitRedirect = (
    Deno.env.get('ABSTRACK_CARETAKER_INVITE_REDIRECT_TO') ?? ''
  ).trim();
  const inviteWebOrigin = explicitRedirect
    ? null
    : normalizeInviteWebOriginForRedirect(
        Deno.env.get('ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN') ?? '',
      );
  const redirectTo =
    explicitRedirect ||
    (inviteWebOrigin
      ? `${inviteWebOrigin}/auth/callback?next=${encodeURIComponent('/caretaker/join')}`
      : '');
  return redirectTo.length > 0 ? redirectTo : null;
}

function isUuidString(s: string): boolean {
  return UUID_RE.test(s);
}

/**
 * Resolves `auth.users.id` for a normalized email via one Postgres round trip
 * (`public.resolve_auth_user_id_by_normalized_email`), avoiding paginated
 * `auth.admin.listUsers` scans as the Auth user count grows.
 */
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
 * After **`caretaker_access` INSERT** fails with **23505**, Postgres may be enforcing either
 * **`UNIQUE (patient_user_id, caretaker_user_id)`** (concurrent finalize/link for the same pair) or
 * the partial unique **one active caretaker per patient** index. Re-read the grant for this pair to
 * tell them apart: an **active** row for **`(patientUserId, caretakerUserId)`** means the insert lost
 * a race to an equivalent write—treat as idempotent success upstream; otherwise keep the
 * “another caretaker already active” **409** path.
 */
async function caretakerAccessInsert23505PairRefetch(
  admin: SupabaseClient,
  patientUserId: string,
  caretakerUserId: string,
): Promise<
  | { kind: 'same_pair_active' }
  | { kind: 'other_constraint' }
  | { kind: 'error'; response: Response }
> {
  const { data: pairRow, error } = await admin
    .from('caretaker_access')
    .select('id, revoked_at')
    .eq('patient_user_id', patientUserId)
    .eq('caretaker_user_id', caretakerUserId)
    .maybeSingle();

  if (error) {
    console.error('caretaker_access insert 23505 pair refetch', error);
    return {
      kind: 'error',
      response: jsonResponse(500, {
        error: 'Unable to verify caretaker access. Try again in a moment.',
      }),
    };
  }

  if (pairRow != null && pairRow.revoked_at == null) {
    return { kind: 'same_pair_active' };
  }
  return { kind: 'other_constraint' };
}

/**
 * Stamps **`last_invite_sent_at`** before **`inviteUserByEmail`** so resend throttle applies even if
 * Auth succeeds and a later failure would return **500** (stamp-after-send allowed unthrottled retries).
 *
 * The stamp runs via **`rpc('stamp_caretaker_invite_pre_send', …)`** (`public.stamp_caretaker_invite_pre_send`
 * in migrations): a single **`UPDATE`** with **`consumed_at IS NULL`** and an **atomic resend window** on
 * **`last_invite_sent_at`** (`NULL` or at/before the throttle cutoff — inclusive **`<=`**, matching Edge
 * **`elapsed >= CARETAKER_INVITE_MIN_RESEND_INTERVAL_MS`**) so two
 * concurrent callers cannot both pass a non-atomic throttle read and send duplicate Auth emails. This
 * avoids PostgREST-only quirks on the same row update; **`service_role`** must **`EXECUTE`** the RPC.
 *
 * **`data`** from **`rpc`** is treated like a list of updated row ids: **exactly one** id means this
 * request won the stamp; **zero** ids → follow-up read for **429** (throttled), **404**, or **409** (see
 * handler). When **`deletePendingInviteOnMailFailure`** is true, failed sends roll back by deleting the
 * pending invite row (new-invite path), dropping the stamp with the row. When false, the row is kept
 * (resend while invitee has Auth user but no profile yet); a stamp without a delivered mail still
 * enforces throttle until the interval passes.
 */
async function sendCaretakerInviteEmailAndStamp(
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
    nowMs - CARETAKER_INVITE_MIN_RESEND_INTERVAL_MS,
  ).toISOString();

  const { data: stampedRows, error: stampErr } = await admin.rpc(
    'stamp_caretaker_invite_pre_send',
    {
      p_invite_id: inviteId,
      p_stamp: stampNowIso,
      p_throttle_cutoff: throttleCutoffIso,
    },
  );

  if (stampErr) {
    console.error('caretaker_invites last_invite_sent_at (pre-send)', stampErr);
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
        'caretaker_invites pre-send stamp unexpected row count',
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
      .from('caretaker_invites')
      .select('id, consumed_at, last_invite_sent_at')
      .eq('id', inviteId)
      .maybeSingle();

    if (inviteReadErr) {
      console.error('caretaker_invites pre-send stale read', inviteReadErr);
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

    const lostRaceThrottle = caretakerInviteResendTooSoon(
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
      'caretaker_invites pre-send atomic stamp matched no row (unexpected)',
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
      data: { abstrack_caretaker_invite_id: inviteId, app_role: 'caretaker' },
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
          .from('caretaker_invites')
          .delete()
          .eq('id', inviteId);
        if (rollbackDelErr) {
          console.error(
            'caretaker_invites rollback delete (account exists)',
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
            'An account already exists for that email. Ask them to sign in as a caretaker, or use “link” after they finish signup.',
        }),
      };
    }
    console.error('inviteUserByEmail', invMailErr);
    if (deletePendingInviteOnMailFailure) {
      const { error: rollbackDelErr } = await admin
        .from('caretaker_invites')
        .delete()
        .eq('id', inviteId);
      if (rollbackDelErr) {
        console.error(
          'caretaker_invites rollback delete (invite email failed)',
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

/**
 * Best-effort: removes the Supabase Auth user created for a withdrawn caretaker email invite when
 * that user was only tied to this invite (metadata `abstrack_caretaker_invite_id` matches) and has
 * no active caretaker grant yet.
 *
 * Skips when the email maps to no user, metadata does not match (different invite / manual
 * accounts), or any active `caretaker_access` row exists for this user as caretaker.
 *
 * @param admin Elevated Supabase client.
 * @param inviteId Primary key of the `caretaker_invites` row that was just removed.
 * @param inviteeEmailNormalized `caretaker_invites.invitee_email_normalized` for the removed row.
 */
async function deleteOrphanInvitedCaretakerAuthUserAfterInviteRemoved(
  admin: SupabaseClient,
  inviteId: string,
  inviteeEmailNormalized: string,
): Promise<void> {
  let caretakerUserId: string | null = null;
  try {
    caretakerUserId = await resolveAuthUserIdByEmail(
      admin,
      inviteeEmailNormalized,
    );
  } catch (e) {
    console.warn(
      'caretaker_invite_cancel auth lookup failed (invite row already deleted)',
      inviteId,
      e,
    );
    return;
  }
  if (!caretakerUserId) {
    return;
  }

  const { data: authUserRes, error: getErr } =
    await admin.auth.admin.getUserById(caretakerUserId);
  if (getErr || !authUserRes?.user) {
    console.warn(
      'caretaker_invite_cancel getUser',
      inviteId,
      caretakerUserId,
      getErr,
    );
    return;
  }

  const metaInvite =
    authUserRes.user.user_metadata?.abstrack_caretaker_invite_id;
  if (typeof metaInvite !== 'string' || metaInvite !== inviteId) {
    return;
  }

  const { data: activeGrant, error: grantErr } = await admin
    .from('caretaker_access')
    .select('id')
    .eq('caretaker_user_id', caretakerUserId)
    .is('revoked_at', null)
    .maybeSingle();

  if (grantErr) {
    console.warn(
      'caretaker_invite_cancel caretaker_access lookup',
      inviteId,
      grantErr,
    );
    return;
  }
  if (activeGrant) {
    return;
  }

  const { error: delErr } = await admin.auth.admin.deleteUser(caretakerUserId);
  if (delErr) {
    console.warn(
      'caretaker_invite_cancel deleteUser',
      inviteId,
      caretakerUserId,
      delErr,
    );
  }
}

/**
 * Deletes unconsumed caretaker invite rows for a patient (best-effort cleanup). For each removed
 * row, attempts to delete the invitee Auth user when they were created only for that invite and
 * have not been linked as a caretaker yet.
 *
 * @returns Supabase error when the delete fails; callers must not treat success as committed otherwise.
 */
async function clearPendingInvitesForPatient(
  admin: SupabaseClient,
  patientUserId: string,
): Promise<{ error: unknown | null }> {
  const { data: removed, error } = await admin
    .from('caretaker_invites')
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
    await deleteOrphanInvitedCaretakerAuthUserAfterInviteRemoved(
      admin,
      inviteId,
      emailNorm,
    );
  }

  return { error: null };
}

/**
 * Atomically marks a caretaker invite consumed (`consumed_at IS NULL` in the UPDATE filter).
 * Under concurrency, at most one caller wins the row; another gets zero updated rows and is
 * resolved via refetch (same caretaker → idempotent success; otherwise 409 / 404 / 500).
 *
 * @param admin Elevated Supabase client.
 * @param inviteId Invite primary key.
 * @param caretakerUserId Authenticated caretaker (`auth.users.id`).
 * @param consumedAtIso Timestamp for `consumed_at`.
 * @returns `ok: true` when this request consumed the row or the row was already consumed by the same caretaker.
 */
async function consumeCaretakerInviteForFinalize(
  admin: SupabaseClient,
  inviteId: string,
  caretakerUserId: string,
  consumedAtIso: string,
): Promise<{ ok: true } | { ok: false; response: Response }> {
  const { data, error } = await admin
    .from('caretaker_invites')
    .update({
      consumed_at: consumedAtIso,
      consumed_caretaker_user_id: caretakerUserId,
    })
    .eq('id', inviteId)
    .is('consumed_at', null)
    .select('id');

  if (error) {
    console.error('finalize consume invite', error);
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
    .from('caretaker_invites')
    .select('consumed_at, consumed_caretaker_user_id')
    .eq('id', inviteId)
    .maybeSingle();

  if (refetchErr) {
    console.error('finalize consume invite refetch', refetchErr);
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
    if (row.consumed_caretaker_user_id === caretakerUserId) {
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
    'finalize consume invite: update matched no rows but invite still pending',
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
 * Runs {@link consumeCaretakerInviteForFinalize} after optional `caretaker_access` mutation.
 *
 * When **`rollbackActiveGrantOnConsume404`** is true (this request just **inserted** or
 * **reactivated** a grant), a consume **404** (invite row gone, e.g. patient cancelled) **revokes**
 * that new active row so cancel semantics win, then returns the **404** response.
 *
 * When false, a consume **404** with an existing active grant for this pair is treated as
 * idempotent **200** (e.g. **`already_linked`** or a **23505** race where this request did not
 * apply the grant write).
 */
async function finalizeConsumeInviteAfterGrant(
  admin: SupabaseClient,
  inviteId: string,
  caretakerUserId: string,
  patientUserId: string,
  nowIso: string,
  outcome: 'already_linked' | 'linked',
  rollbackActiveGrantOnConsume404: boolean,
): Promise<Response> {
  const consumed = await consumeCaretakerInviteForFinalize(
    admin,
    inviteId,
    caretakerUserId,
    nowIso,
  );
  if (consumed.ok) {
    return jsonResponse(200, { ok: true, outcome });
  }
  if (consumed.response.status === 404 && rollbackActiveGrantOnConsume404) {
    const { error: rbErr } = await admin
      .from('caretaker_access')
      .update({ revoked_at: nowIso })
      .eq('patient_user_id', patientUserId)
      .eq('caretaker_user_id', caretakerUserId)
      .is('revoked_at', null);
    if (rbErr) {
      console.error(
        'finalize rollback grant after consume 404',
        inviteId,
        rbErr,
      );
    } else {
      console.warn(
        'finalize: rolled back grant after invite missing (consume 404)',
        inviteId,
      );
    }
    return consumed.response;
  }
  if (consumed.response.status === 404 && !rollbackActiveGrantOnConsume404) {
    const { data: link, error: linkErr } = await admin
      .from('caretaker_access')
      .select('id, revoked_at')
      .eq('patient_user_id', patientUserId)
      .eq('caretaker_user_id', caretakerUserId)
      .maybeSingle();
    if (!linkErr && link && link.revoked_at == null) {
      console.warn(
        'finalize: invite row missing; idempotent success (no grant rollback)',
        inviteId,
      );
      return jsonResponse(200, { ok: true, outcome });
    }
  }
  return consumed.response;
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
      'id, patient_user_id, invitee_email_normalized, expires_at, consumed_at, consumed_caretaker_user_id',
    )
    .eq('id', inviteId)
    .maybeSingle();

  if (invErr) {
    console.error('finalize invite lookup', invErr);
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
    if (invite.consumed_caretaker_user_id === user.id) {
      const patientIdDone = invite.patient_user_id as string;
      const { data: pairActive, error: pairDoneErr } = await admin
        .from('caretaker_access')
        .select('id')
        .eq('patient_user_id', patientIdDone)
        .eq('caretaker_user_id', user.id)
        .is('revoked_at', null)
        .maybeSingle();
      if (pairDoneErr) {
        console.error('finalize idempotent consumed pair lookup', pairDoneErr);
        return jsonResponse(500, {
          error: 'Unable to verify caretaker access. Try again in a moment.',
        });
      }
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
    return await finalizeConsumeInviteAfterGrant(
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
      .from('caretaker_access')
      .update({ revoked_at: null })
      .eq('id', existingPair.id);

    if (updError) {
      if (isPostgresUniqueViolation(updError)) {
        const { data: activeGrant, error: activeErr } = await admin
          .from('caretaker_access')
          .select('caretaker_user_id')
          .eq('patient_user_id', patientId)
          .is('revoked_at', null)
          .maybeSingle();
        if (!activeErr && activeGrant?.caretaker_user_id === user.id) {
          return await finalizeConsumeInviteAfterGrant(
            admin,
            inviteId,
            user.id,
            patientId,
            nowIso,
            'linked',
            false,
          );
        }
        return jsonResponse(409, {
          error:
            'This patient already has another active caretaker. They must revoke access before you can join.',
        });
      }
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
        const dup = await caretakerAccessInsert23505PairRefetch(
          admin,
          patientId,
          user.id,
        );
        if (dup.kind === 'error') {
          return dup.response;
        }
        if (dup.kind === 'same_pair_active') {
          return await finalizeConsumeInviteAfterGrant(
            admin,
            inviteId,
            user.id,
            patientId,
            nowIso,
            'linked',
            false,
          );
        }
        return jsonResponse(409, {
          error:
            'This patient already has another active caretaker. They must revoke access before you can join.',
        });
      }
      console.error('finalize insert', insError);
      return jsonResponse(500, { error: 'Unable to link caretaker access.' });
    }
  }

  return await finalizeConsumeInviteAfterGrant(
    admin,
    inviteId,
    user.id,
    patientId,
    nowIso,
    'linked',
    true,
  );
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
      const { error: clearPendingErr } = await clearPendingInvitesForPatient(
        admin,
        user.id,
      );
      if (clearPendingErr) {
        console.error('caretaker_access DELETE clear pending', clearPendingErr);
        return jsonResponse(500, {
          error: 'Unable to clear pending caretaker invite.',
        });
      }
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

    const { error: clearPendingErr } = await clearPendingInvitesForPatient(
      admin,
      user.id,
    );
    if (clearPendingErr) {
      console.error('caretaker_access revoke clear pending', clearPendingErr);
      return jsonResponse(200, {
        ok: true,
        pendingInviteCleanupFailed: true,
      });
    }

    return jsonResponse(200, { ok: true });
  }

  // POST — patient (finalize handled above)
  if (!postBody) {
    return jsonResponse(400, { error: 'Expected JSON body.' });
  }

  if (postBody.cancelPendingCaretakerInvite === true) {
    const { error: clearPendingErr } = await clearPendingInvitesForPatient(
      admin,
      user.id,
    );
    if (clearPendingErr) {
      console.error('cancel pending caretaker invite', clearPendingErr);
      return jsonResponse(500, {
        error: 'Unable to cancel the pending invite. Try again in a moment.',
      });
    }
    return jsonResponse(200, { ok: true, outcome: 'invite_cancelled' });
  }

  const rawEmail = postBody.caretakerEmail;
  if (typeof rawEmail !== 'string' || !normalizeEmailForLookup(rawEmail)) {
    return jsonResponse(400, { error: 'Enter the caretaker’s email address.' });
  }

  const normalizedTarget = normalizeEmailForLookup(rawEmail);
  if (!isPlausibleCaretakerInviteEmail(normalizedTarget)) {
    return jsonResponse(400, {
      error:
        'Enter a valid email address for the caretaker (for example, name@example.com).',
    });
  }

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
      const { data: pendingResend, error: pendResendErr } = await admin
        .from('caretaker_invites')
        .select('id, invitee_email_normalized, expires_at, last_invite_sent_at')
        .eq('patient_user_id', user.id)
        .is('consumed_at', null)
        .maybeSingle();

      if (pendResendErr) {
        console.error(
          'caretaker_invites resend (auth user, no profile) read',
          pendResendErr,
        );
        return jsonResponse(500, {
          error: 'Unable to verify pending invite. Try again in a moment.',
        });
      }

      if (
        pendingResend &&
        (pendingResend.invitee_email_normalized as string) === normalizedTarget
      ) {
        const redirectResend = resolveCaretakerInviteRedirectTo();
        if (!redirectResend) {
          console.error(
            'Missing ABSTRACK_CARETAKER_INVITE_REDIRECT_TO (e.g. abstrack:///caretaker-invite) or ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN for web fallback.',
          );
          return jsonResponse(500, {
            error: 'server_misconfigured',
          });
        }
        const resendThrottle = caretakerInviteResendTooSoon(
          pendingResend.last_invite_sent_at as string | null | undefined,
          Date.now(),
        );
        if (resendThrottle.tooSoon) {
          return jsonResponse(
            429,
            {
              error: 'Please wait before resending the invite.',
              retryAfterSeconds: resendThrottle.retryAfterSec,
            },
            {
              'Retry-After': String(resendThrottle.retryAfterSec),
            },
          );
        }
        const refreshedResend = await refreshCaretakerInviteExpiryIfNeeded(
          admin,
          pendingResend.id as string,
          pendingResend.expires_at as string,
          Date.now(),
        );
        if (!refreshedResend.ok) {
          return refreshedResend.response;
        }
        const mailResend = await sendCaretakerInviteEmailAndStamp(admin, {
          inviteId: pendingResend.id as string,
          normalizedTarget,
          redirectTo: redirectResend,
          inviteExpiresAt: refreshedResend.expiresAt,
          deletePendingInviteOnMailFailure: false,
        });
        if (!mailResend.ok) {
          return mailResend.response;
        }
        return jsonResponse(200, {
          ok: true,
          outcome: 'invite_sent',
          inviteExpiresAt: mailResend.inviteExpiresAt,
        });
      }

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
      const { error: clearPendingErr } = await clearPendingInvitesForPatient(
        admin,
        user.id,
      );
      if (clearPendingErr) {
        console.error(
          'link caretaker clear pending (best-effort; grant already active)',
          clearPendingErr,
        );
      }
      return jsonResponse(200, {
        ok: true,
        outcome: 'already_linked',
        ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
      });
    }

    if (existingPair && existingPair.revoked_at != null) {
      const { error: updError } = await admin
        .from('caretaker_access')
        .update({ revoked_at: null })
        .eq('id', existingPair.id);

      if (updError) {
        if (isPostgresUniqueViolation(updError)) {
          const { data: activeGrant, error: activeErr } = await admin
            .from('caretaker_access')
            .select('caretaker_user_id')
            .eq('patient_user_id', user.id)
            .is('revoked_at', null)
            .maybeSingle();
          if (
            !activeErr &&
            activeGrant?.caretaker_user_id === caretakerUserId
          ) {
            const { error: clearPendingErr } =
              await clearPendingInvitesForPatient(admin, user.id);
            if (clearPendingErr) {
              console.error(
                'link caretaker reactivate concurrent clear pending (best-effort; grant linked)',
                clearPendingErr,
              );
            }
            return jsonResponse(200, {
              ok: true,
              outcome: 'linked',
              reactivated: true,
              ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
            });
          }
          return jsonResponse(409, {
            error:
              'You already have an active caretaker. Revoke access before linking someone else.',
          });
        }
        console.error('caretaker_access reactivate', updError);
        return jsonResponse(500, {
          error: 'Unable to restore caretaker access.',
        });
      }
      const { error: clearPendingErr } = await clearPendingInvitesForPatient(
        admin,
        user.id,
      );
      if (clearPendingErr) {
        console.error(
          'link caretaker reactivate clear pending (best-effort; grant reactivated)',
          clearPendingErr,
        );
      }
      return jsonResponse(200, {
        ok: true,
        outcome: 'linked',
        reactivated: true,
        ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
      });
    }

    const { error: insError } = await admin.from('caretaker_access').insert({
      patient_user_id: user.id,
      caretaker_user_id: caretakerUserId,
    });

    if (insError) {
      if (isPostgresUniqueViolation(insError)) {
        const dup = await caretakerAccessInsert23505PairRefetch(
          admin,
          user.id,
          caretakerUserId,
        );
        if (dup.kind === 'error') {
          return dup.response;
        }
        if (dup.kind === 'same_pair_active') {
          const { error: clearPendingErr } =
            await clearPendingInvitesForPatient(admin, user.id);
          if (clearPendingErr) {
            console.error(
              'link caretaker insert 23505 same-pair clear pending (best-effort; grant linked)',
              clearPendingErr,
            );
          }
          return jsonResponse(200, {
            ok: true,
            outcome: 'already_linked',
            ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
          });
        }
        return jsonResponse(409, {
          error:
            'You already have an active caretaker. Revoke access before linking someone else.',
        });
      }
      console.error('caretaker_access insert', insError);
      return jsonResponse(500, { error: 'Unable to link caretaker access.' });
    }

    const { error: clearPendingErr } = await clearPendingInvitesForPatient(
      admin,
      user.id,
    );
    if (clearPendingErr) {
      console.error(
        'link caretaker insert clear pending (best-effort; grant inserted)',
        clearPendingErr,
      );
    }
    return jsonResponse(200, {
      ok: true,
      outcome: 'linked',
      reactivated: false,
      ...(clearPendingErr ? { pendingInviteCleanupFailed: true } : {}),
    });
  }

  // No Auth user for this email — send Supabase invite email + pending row
  if (otherActive) {
    return jsonResponse(409, {
      error:
        'You already have an active caretaker. Revoke access before inviting someone else.',
    });
  }

  const redirectTo = resolveCaretakerInviteRedirectTo();
  if (!redirectTo) {
    console.error(
      'Missing ABSTRACK_CARETAKER_INVITE_REDIRECT_TO (e.g. abstrack:///caretaker-invite) or ABSTRACK_CARETAKER_INVITE_WEB_ORIGIN for web fallback.',
    );
    return jsonResponse(500, {
      error: 'server_misconfigured',
    });
  }

  const nowMs = Date.now();
  const { data: pendingForThrottle, error: throttleReadErr } = await admin
    .from('caretaker_invites')
    .select('invitee_email_normalized, last_invite_sent_at')
    .eq('patient_user_id', user.id)
    .is('consumed_at', null)
    .maybeSingle();

  if (throttleReadErr) {
    console.error('caretaker_invites resend throttle read', throttleReadErr);
    return jsonResponse(500, {
      error: 'Unable to verify pending invite. Try again in a moment.',
    });
  }

  if (
    pendingForThrottle &&
    (pendingForThrottle.invitee_email_normalized as string) === normalizedTarget
  ) {
    const throttle = caretakerInviteResendTooSoon(
      pendingForThrottle.last_invite_sent_at as string | null | undefined,
      nowMs,
    );
    if (throttle.tooSoon) {
      return jsonResponse(
        429,
        {
          error: 'Please wait before resending the invite.',
          retryAfterSeconds: throttle.retryAfterSec,
        },
        {
          'Retry-After': String(throttle.retryAfterSec),
        },
      );
    }
  }

  const { error: clearBeforeInviteErr } = await clearPendingInvitesForPatient(
    admin,
    user.id,
  );
  if (clearBeforeInviteErr) {
    console.error('invite caretaker clear pending', clearBeforeInviteErr);
    return jsonResponse(500, {
      error: 'Unable to clear previous pending invite. Try again in a moment.',
    });
  }

  const newExpiresAt = inviteExpiresAtIso();
  const { data: invRow, error: insInvErr } = await admin
    .from('caretaker_invites')
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
        .from('caretaker_invites')
        .select('id, invitee_email_normalized, expires_at, last_invite_sent_at')
        .eq('patient_user_id', user.id)
        .is('consumed_at', null)
        .maybeSingle();

      if (pendSelErr || !pending?.id) {
        console.error(
          'caretaker_invites insert race recover',
          pendSelErr,
          insInvErr,
        );
        return jsonResponse(500, {
          error: 'Unable to create caretaker invite.',
        });
      }

      if ((pending.invitee_email_normalized as string) !== normalizedTarget) {
        return jsonResponse(409, {
          error:
            'A pending invite is already in progress for a different email. Cancel the pending invite first.',
        });
      }

      const raceThrottle = caretakerInviteResendTooSoon(
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
      const refreshedRace = await refreshCaretakerInviteExpiryIfNeeded(
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
      console.error('caretaker_invites insert', insInvErr);
      return jsonResponse(500, { error: 'Unable to create caretaker invite.' });
    }
  } else {
    if (!invRow?.id) {
      console.error('caretaker_invites insert missing id', insInvErr);
      return jsonResponse(500, { error: 'Unable to create caretaker invite.' });
    }
    inviteId = invRow.id as string;
    inviteExpiresAt = newExpiresAt;
  }

  const mailNew = await sendCaretakerInviteEmailAndStamp(admin, {
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
