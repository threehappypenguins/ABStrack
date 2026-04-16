/**
 * Server-side MFA assurance audit for practitioners (Supabase Edge Function).
 *
 * Verifies the caller JWT (AAL claim) and profile role, then either returns success or writes an
 * `access_log` row with `action = auth_failure` and HTTP 403 when MFA assurance is missing.
 * RLS on PHI tables remains the primary enforcement; this function provides an append-only audit
 * path in a separate transaction (RLS denial via RAISE does not persist `access_log` rows).
 *
 * HTTP contract (callers should handle each):
 * - **204** — `profiles.app_role` is `practitioner` and JWT `aal` is `aal2` (nothing to audit).
 * - **403** — practitioner and `aal` is not `aal2`; `access_log` row inserted (`auth_failure`).
 * - **200** + `{ ok: true, audited: false, reason: "not_practitioner" }` — authenticated user is
 *   not a practitioner; MFA audit does not apply (distinct from 204 so clients can detect wrong
 *   role or mis-scoped calls).
 * - **400** — invalid optional `patient_user_id` in JSON body (malformed UUID).
 * - **401** — missing/invalid Bearer session or JWT payload.
 * - **405** — not POST.
 * - **500** — server misconfiguration or unexpected DB failure on insert.
 *
 * Deploy: `pnpm dlx supabase functions deploy practitioner-mfa-auth-audit` (secrets from project).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createClient, type SupabaseClient } from 'jsr:@supabase/supabase-js@2';
import { decodeJwt } from 'npm:jose@5';

/** Matches Supabase Edge CORS guidance (authorization + apikey for supabase-js). */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** RFC 9110: auth scheme is case-insensitive; capture token after one or more spaces. */
const BEARER_AUTH_RE = /^\s*Bearer\s+(.*)$/i;

/**
 * Parses a Bearer token from the `Authorization` header (case-insensitive scheme).
 *
 * @param authorization - Raw `Authorization` header value, or null if absent.
 * @returns The token string, or null if missing, empty, or not a Bearer credential.
 */
function parseBearerToken(authorization: string | null): string | null {
  if (authorization == null || authorization === '') {
    return null;
  }
  const m = authorization.match(BEARER_AUTH_RE);
  if (!m) {
    return null;
  }
  const raw = m[1]?.trim() ?? '';
  return raw.length > 0 ? raw : null;
}

/** Parsed `patient_user_id` body field: omitted, syntactically invalid, or valid UUID string. */
type PatientUserIdField =
  | { kind: 'absent' }
  | { kind: 'invalid'; message: string }
  | { kind: 'valid'; uuid: string };

/**
 * Interprets the optional JSON `patient_user_id` for audit context.
 *
 * @param value - Raw `body.patient_user_id` value.
 * @returns Absent if omitted/null/empty, invalid if wrong type or not a UUID string, else valid.
 */
function parsePatientUserIdField(value: unknown): PatientUserIdField {
  if (value === undefined || value === null) {
    return { kind: 'absent' };
  }
  if (typeof value !== 'string') {
    return {
      kind: 'invalid',
      message: 'patient_user_id must be a string UUID when provided.',
    };
  }
  const trimmed = value.trim();
  if (trimmed === '') {
    return { kind: 'absent' };
  }
  if (!UUID_RE.test(trimmed)) {
    return {
      kind: 'invalid',
      message: 'patient_user_id must be a valid UUID.',
    };
  }
  return { kind: 'valid', uuid: trimmed };
}

/**
 * Resolves whether a patient id may be stored on `access_log`: user must exist in Auth and share an
 * active practitioner grant; otherwise returns null to satisfy FK and avoid bogus attribution.
 *
 * @param admin - Service-role Supabase client.
 * @param practitionerUserId - Authenticated practitioner (`sub`).
 * @param field - Parsed body field (only `valid` carries a UUID to resolve).
 * @returns `patient_user_id` for insert or null.
 */
async function resolveAuditPatientUserId(
  admin: SupabaseClient,
  practitionerUserId: string,
  field: PatientUserIdField,
): Promise<string | null> {
  if (field.kind !== 'valid') {
    return null;
  }
  const candidate = field.uuid;

  const { data: authData, error: authErr } =
    await admin.auth.admin.getUserById(candidate);
  if (authErr || !authData?.user) {
    return null;
  }

  const { data: grant, error: grantErr } = await admin
    .from('practitioner_access')
    .select('patient_user_id')
    .eq('practitioner_user_id', practitionerUserId)
    .eq('patient_user_id', candidate)
    .is('revoked_at', null)
    .maybeSingle();

  if (grantErr || !grant) {
    return null;
  }

  return candidate;
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'method_not_allowed' }), {
      status: 405,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const token = parseBearerToken(req.headers.get('Authorization'));
  if (token == null) {
    return new Response(JSON.stringify({ error: 'missing_authorization' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let body: { patient_user_id?: unknown };
  try {
    body = (await req.json()) as { patient_user_id?: unknown };
  } catch {
    body = {};
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData.user) {
    return new Response(JSON.stringify({ error: 'invalid_session' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const { data: profile, error: profileErr } = await admin
    .from('profiles')
    .select('app_role')
    .eq('id', userData.user.id)
    .maybeSingle();

  if (profileErr) {
    return new Response(JSON.stringify({ error: 'profile_lookup_failed' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (profile?.app_role !== 'practitioner') {
    return new Response(
      JSON.stringify({ ok: true, audited: false, reason: 'not_practitioner' }),
      {
        status: 200,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const patientField = parsePatientUserIdField(body?.patient_user_id);
  if (patientField.kind === 'invalid') {
    return new Response(
      JSON.stringify({
        error: 'invalid_patient_user_id',
        message: patientField.message,
      }),
      {
        status: 400,
        headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
      },
    );
  }

  const resolvedPatientUserId = await resolveAuditPatientUserId(
    admin,
    userData.user.id,
    patientField,
  );

  let aal: string | undefined;
  try {
    const claims = decodeJwt(token) as { aal?: string };
    aal = claims.aal;
  } catch {
    return new Response(JSON.stringify({ error: 'invalid_jwt_payload' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  if (aal === 'aal2') {
    return new Response(null, {
      status: 204,
      headers: CORS_HEADERS,
    });
  }

  const { error: insertErr } = await admin.from('access_log').insert({
    actor_user_id: userData.user.id,
    actor_role: 'practitioner',
    patient_user_id: resolvedPatientUserId,
    action: 'auth_failure',
    resource_type: 'practitioner_mfa_assurance',
    resource_id: null,
  });

  if (insertErr) {
    console.error('access_log insert failed', insertErr);
    return new Response(JSON.stringify({ error: 'audit_write_failed' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  return new Response(
    JSON.stringify({
      error: 'mfa_assurance_required',
      message:
        'Practitioner session must have MFA assurance (AAL2) to access patient data.',
    }),
    {
      status: 403,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    },
  );
});
