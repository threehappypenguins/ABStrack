/**
 * Patient-initiated **`practitioner_access`** grants and practitioner email invites (PRD §8).
 * Verified patient session + elevated Supabase client (default secret key from `SUPABASE_SECRET_KEYS`).
 * Writes use **service_role**; RLS includes explicit `TO service_role` policies in
 * `supabase/migrations/20260514120000_practitioner_access_service_role_edge.sql`.
 * User web + mobile call `…/functions/v1/patient-practitioner-access` with user JWT + `apikey` (publishable).
 *
 * Practitioner data reads remain **fail-closed** on MFA (AAL2) via RLS and
 * `practitioner-mfa-auth-audit`; this function only manages the **grant row** and Auth invite.
 * Revoking sets **`revoked_at`** (patient data the practitioner already saw is not erased; future
 * reads are denied by RLS per PRD).
 *
 * HTTP:
 * - **GET** — patient: list active practitioner grants (email + display name from Auth/ profiles).
 * - **POST** — patient: `{ practitionerEmail }` invite new account or link existing practitioner;
 *   `{ revokePractitionerUserId }` set **`revoked_at`** on the matching active grant;
 *   `{ practitionerEmail, resendPractitionerInvite: true }` resend Supabase invite email when an
 *   active grant already exists for that practitioner (same **`redirectTo`** rules).
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

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';

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
 * Ensures **`profiles.app_role = practitioner`** for **`userId`** via trusted service client.
 *
 * @returns Error response when an existing profile has a different role.
 */
async function ensurePractitionerProfile(
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
  const prof = await ensurePractitionerProfile(admin, practitionerUserId);
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

  if (grant.kind === 'active') {
    return jsonResponse(200, {
      ok: true,
      outcome: 'already_linked',
    });
  }

  return jsonResponse(200, {
    ok: true,
    outcome: 'linked',
    ...(grant.kind === 'reactivated' ? { reactivated: true } : {}),
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

    const grants: Array<{
      id: string;
      practitionerUserId: string;
      practitionerEmail: string | null;
      practitionerDisplayName: string | null;
      createdAt: string;
    }> = [];

    for (const r of rows ?? []) {
      const pid = r.practitioner_user_id as string;
      let practitionerEmail: string | null = null;
      try {
        const { data: authRes } = await admin.auth.admin.getUserById(pid);
        practitionerEmail = authRes.user?.email ?? null;
      } catch {
        practitionerEmail = null;
      }

      const { data: pRow } = await admin
        .from('profiles')
        .select('display_name')
        .eq('id', pid)
        .maybeSingle();

      grants.push({
        id: r.id as string,
        practitionerUserId: pid,
        practitionerEmail,
        practitionerDisplayName: pRow?.display_name ?? null,
        createdAt: r.created_at as string,
      });
    }

    return jsonResponse(200, { grants });
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
          'No account exists for that email yet. Send an initial invite without resend first.',
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
          'There is no active practitioner grant for that email. Send a new invite first.',
      });
    }

    const redirectTo = resolvePractitionerInviteRedirectTo();
    if (!redirectTo) {
      console.error(
        'Missing ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO or ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN.',
      );
      return jsonResponse(500, { error: 'server_misconfigured' });
    }

    const { error: mailErr } = await admin.auth.admin.inviteUserByEmail(
      normalizedTarget,
      { redirectTo },
    );
    if (mailErr) {
      const msg = (mailErr as { message?: string }).message ?? '';
      console.error('inviteUserByEmail resend', mailErr);
      return jsonResponse(500, {
        error:
          msg.trim() !== ''
            ? `Unable to resend the invite email: ${msg}`
            : 'Unable to resend the invite email right now. Try again in a moment.',
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

  // No Auth user — invite by email, then profile + grant
  const redirectTo = resolvePractitionerInviteRedirectTo();
  if (!redirectTo) {
    console.error(
      'Missing ABSTRACK_PRACTITIONER_INVITE_REDIRECT_TO or ABSTRACK_PRACTITIONER_INVITE_WEB_ORIGIN.',
    );
    return jsonResponse(500, { error: 'server_misconfigured' });
  }

  const { data: invited, error: invErr } =
    await admin.auth.admin.inviteUserByEmail(normalizedTarget, {
      redirectTo,
    });

  if (invErr || !invited.user?.id) {
    const msg = (invErr as { message?: string } | undefined)?.message ?? '';
    const lower = msg.toLowerCase();
    if (
      lower.includes('already') ||
      lower.includes('registered') ||
      lower.includes('exists')
    ) {
      let existingId: string | null = null;
      try {
        existingId = await resolveAuthUserIdByEmail(admin, rawEmail);
      } catch (e) {
        console.error('resolve after invite exists error', e);
      }
      if (existingId) {
        return await linkExistingPractitionerByUserId(
          admin,
          user.id,
          existingId,
        );
      }
      return jsonResponse(409, {
        error:
          'An account may already exist for that email. Ask them to open the practitioner app, or try again in a moment.',
      });
    }
    console.error('inviteUserByEmail practitioner', invErr);
    return jsonResponse(500, {
      error:
        'Unable to send the invite email right now. Try again in a moment.',
    });
  }

  const newUserId = invited.user.id;

  const prof = await ensurePractitionerProfile(admin, newUserId);
  if (!prof.ok) {
    return prof.response;
  }

  const grant = await upsertActivePractitionerGrant(admin, user.id, newUserId);
  if (grant.kind === 'error') {
    return grant.response;
  }

  const outcome =
    grant.kind === 'active'
      ? 'already_linked'
      : grant.kind === 'reactivated'
        ? 'linked'
        : 'invite_sent';

  return jsonResponse(200, {
    ok: true,
    outcome,
    ...(grant.kind === 'reactivated' ? { reactivated: true } : {}),
  });
});
