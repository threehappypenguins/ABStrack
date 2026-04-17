/**
 * Normalized view of Supabase access-token JWT fields used for ABStrack routing and policy checks.
 *
 * **Role split:** `profiles.app_role` (patient | caretaker | practitioner) is the application
 * role and MUST be read from Postgres for routing decisions. The JWT `role` claim names the
 * Supabase Auth API role (`authenticated`, `anon`, `service_role`) and MUST NOT be used as
 * `app_role`. See `docs/AUTH_CLAIM_CONTRACT.md`.
 */

import { isAppRole, type AppRole } from '@abstrack/types';

/**
 * Subset of Supabase Auth JWT payload fields relied on by ABStrack client and server code.
 *
 * Values are produced by Supabase Auth; we decode the access token payload locally for UI gating.
 * **Authorization for PHI remains enforced by RLS** (and Edge Functions where applicable), not by
 * these client-side checks.
 */
export type AbstrackAccessTokenClaims = {
  /** Subject (auth user id). */
  sub?: string;
  /** Unix expiry seconds. */
  exp?: number;
  /**
   * Supabase Auth API role (`authenticated`, `anon`, `service_role`).
   * **Not** `profiles.app_role`; do not use for app routing.
   */
  role?: string;
  /**
   * Authenticator assurance level from Supabase (`aal1` password-only, `aal2` after MFA step).
   * Practitioner patient-data paths require `aal2` in RLS (`user_has_practitioner_access`).
   */
  aal?: string;
  /** Authentication methods references (Supabase). */
  amr?: { method: string; timestamp: number }[];
  session_id?: string;
  email?: string;
};

/**
 * Decodes a JWT access token payload without verifying the signature.
 *
 * Callers MUST only use this on tokens already issued to the Supabase client session; signature
 * verification is performed by Supabase on refresh and server-side `getUser()` flows.
 *
 * @param accessToken - Bearer access token string, or undefined if absent.
 * @returns Parsed payload fields, or null if malformed.
 */
export function parseAbstrackAccessTokenClaims(
  accessToken: string | undefined,
): AbstrackAccessTokenClaims | null {
  if (accessToken == null || accessToken === '') {
    return null;
  }
  const parts = accessToken.split('.');
  if (parts.length !== 3 || !parts[1]) {
    return null;
  }
  try {
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const pad = (4 - (base64.length % 4)) % 4;
    const padded = base64 + '='.repeat(pad);

    let json: string;
    if (typeof atob === 'function') {
      json = atob(padded);
    } else if (
      typeof Buffer !== 'undefined' &&
      typeof Buffer.from === 'function'
    ) {
      json = Buffer.from(padded, 'base64').toString('utf8');
    } else {
      // Hermes / some runtimes: no atob and no Buffer — fail closed (no claims).
      return null;
    }

    const raw = JSON.parse(json) as Record<string, unknown>;
    return raw as AbstrackAccessTokenClaims;
  } catch {
    return null;
  }
}

/**
 * True when MFA assurance for the current session is AAL2 (TOTP-verified step completed).
 *
 * **Fail-closed:** missing `aal`, unknown values, or null claims yield false — no implicit fallback
 * to password-only (`aal1`) for practitioner patient-data gates.
 *
 * @param claims - Parsed access token claims, or null if unavailable.
 * @returns Whether `aal === 'aal2'`.
 */
export function hasMfaAssuranceAal2(
  claims: AbstrackAccessTokenClaims | null,
): boolean {
  return claims?.aal === 'aal2';
}

/**
 * Returns `profiles.app_role` when valid; otherwise null (missing or non-canonical string).
 *
 * @param appRole - Raw `profiles.app_role` column value.
 * @returns Canonical {@link AppRole} or null.
 */
export function parseProfileAppRole(
  appRole: string | null | undefined,
): AppRole | null {
  if (appRole == null || appRole === '') {
    return null;
  }
  return isAppRole(appRole) ? appRole : null;
}

export type PractitionerAppGate =
  | { kind: 'signed_out' }
  | { kind: 'profile_loading' }
  | { kind: 'profile_error'; error: Error }
  | { kind: 'profile_missing' }
  | { kind: 'wrong_app_role'; appRole: AppRole }
  | {
      kind: 'practitioner';
      appRole: 'practitioner';
      hasMfaAssuranceAal2: boolean;
    };

/**
 * Single place for practitioner-app routing and UI gating from session + profile + JWT claims.
 *
 * - **Application role** comes only from `profiles.app_role` (not from JWT `role` or metadata).
 * - **MFA readiness** uses JWT `aal === 'aal2'` only; no ambiguous defaults.
 *
 * @param input - Session presence, profile row or error state, and parsed claims.
 * @returns Discriminated gate for navigation and messaging.
 */
export function resolvePractitionerAppGate(input: {
  hasSession: boolean;
  profile: { app_role: string } | null | undefined;
  profileError: Error | null;
  accessTokenClaims: AbstrackAccessTokenClaims | null;
}): PractitionerAppGate {
  if (!input.hasSession) {
    return { kind: 'signed_out' };
  }
  if (input.profileError) {
    return { kind: 'profile_error', error: input.profileError };
  }
  if (input.profile === undefined) {
    return { kind: 'profile_loading' };
  }
  if (input.profile === null) {
    return { kind: 'profile_missing' };
  }

  const appRole = parseProfileAppRole(input.profile.app_role);
  if (appRole == null) {
    return { kind: 'profile_missing' };
  }
  if (appRole !== 'practitioner') {
    return { kind: 'wrong_app_role', appRole };
  }

  return {
    kind: 'practitioner',
    appRole: 'practitioner',
    hasMfaAssuranceAal2: hasMfaAssuranceAal2(input.accessTokenClaims),
  };
}
