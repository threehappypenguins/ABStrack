import { describe, expect, it } from 'vitest';
import {
  hasMfaAssuranceAal2,
  parseAbstrackAccessTokenClaims,
  parseProfileAppRole,
  resolvePractitionerAppGate,
} from './session-claims.js';

function makeUnsignedJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(
    JSON.stringify({ alg: 'none', typ: 'JWT' }),
    'utf8',
  ).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload), 'utf8').toString(
    'base64url',
  );
  return `${header}.${body}.sig`;
}

describe('parseAbstrackAccessTokenClaims', () => {
  it('returns null for empty or malformed tokens', () => {
    expect(parseAbstrackAccessTokenClaims(undefined)).toBeNull();
    expect(parseAbstrackAccessTokenClaims('')).toBeNull();
    expect(parseAbstrackAccessTokenClaims('not-a-jwt')).toBeNull();
    expect(parseAbstrackAccessTokenClaims('a.b')).toBeNull();
  });

  it('decodes aal and role from a valid JWT-shaped string', () => {
    const token = makeUnsignedJwt({
      aal: 'aal2',
      role: 'authenticated',
      sub: '11111111-1111-1111-1111-111111111111',
    });
    const claims = parseAbstrackAccessTokenClaims(token);
    expect(claims?.aal).toBe('aal2');
    expect(claims?.role).toBe('authenticated');
    expect(claims?.sub).toBe('11111111-1111-1111-1111-111111111111');
  });
});

describe('hasMfaAssuranceAal2', () => {
  it('is true only for exact aal2', () => {
    expect(hasMfaAssuranceAal2(null)).toBe(false);
    expect(hasMfaAssuranceAal2({})).toBe(false);
    expect(hasMfaAssuranceAal2({ aal: 'aal1' })).toBe(false);
    expect(hasMfaAssuranceAal2({ aal: 'aal2' })).toBe(true);
  });
});

describe('parseProfileAppRole', () => {
  it('accepts canonical roles only', () => {
    expect(parseProfileAppRole('practitioner')).toBe('practitioner');
    expect(parseProfileAppRole('invalid')).toBeNull();
    expect(parseProfileAppRole(null)).toBeNull();
  });
});

describe('resolvePractitionerAppGate', () => {
  it('returns signed_out without session', () => {
    expect(
      resolvePractitionerAppGate({
        hasSession: false,
        profile: { app_role: 'practitioner' },
        profileError: null,
        accessTokenClaims: { aal: 'aal2' },
      }),
    ).toEqual({ kind: 'signed_out' });
  });

  it('returns profile_loading when profile not yet available', () => {
    expect(
      resolvePractitionerAppGate({
        hasSession: true,
        profile: undefined,
        profileError: null,
        accessTokenClaims: null,
      }),
    ).toEqual({ kind: 'profile_loading' });
  });

  it('returns wrong_app_role for non-practitioner profiles', () => {
    expect(
      resolvePractitionerAppGate({
        hasSession: true,
        profile: { app_role: 'patient' },
        profileError: null,
        accessTokenClaims: { aal: 'aal2' },
      }),
    ).toEqual({ kind: 'wrong_app_role', appRole: 'patient' });
  });

  it('returns practitioner with hasMfaAssuranceAal2 from claims (no fallback)', () => {
    expect(
      resolvePractitionerAppGate({
        hasSession: true,
        profile: { app_role: 'practitioner' },
        profileError: null,
        accessTokenClaims: null,
      }),
    ).toEqual({
      kind: 'practitioner',
      appRole: 'practitioner',
      hasMfaAssuranceAal2: false,
    });

    expect(
      resolvePractitionerAppGate({
        hasSession: true,
        profile: { app_role: 'practitioner' },
        profileError: null,
        accessTokenClaims: { aal: 'aal2' },
      }),
    ).toEqual({
      kind: 'practitioner',
      appRole: 'practitioner',
      hasMfaAssuranceAal2: true,
    });
  });
});
