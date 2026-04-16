/**
 * Server-side MFA assurance audit for practitioners (Supabase Edge Function).
 *
 * Verifies the caller JWT (AAL claim) and profile role, then either returns success or writes an
 * `access_log` row with `action = auth_failure` and HTTP 403 when MFA assurance is missing.
 * RLS on PHI tables remains the primary enforcement; this function provides an append-only audit
 * path in a separate transaction (RLS denial via RAISE does not persist `access_log` rows).
 *
 * Deploy: `pnpm dlx supabase functions deploy practitioner-mfa-auth-audit` (secrets from project).
 */
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';

import { createClient } from 'jsr:@supabase/supabase-js@2';
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

function parseOptionalPatientId(value: unknown): string | null {
  if (typeof value !== 'string' || !UUID_RE.test(value)) {
    return null;
  }
  return value;
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

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return new Response(JSON.stringify({ error: 'missing_authorization' }), {
      status: 401,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';

  if (!supabaseUrl || !serviceKey) {
    return new Response(JSON.stringify({ error: 'server_misconfigured' }), {
      status: 500,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  }

  let patientUserId: string | null = null;
  try {
    const body = (await req.json()) as { patient_user_id?: unknown };
    patientUserId = parseOptionalPatientId(body?.patient_user_id);
  } catch {
    /* empty body */
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
    patient_user_id: patientUserId,
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
