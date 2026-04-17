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

  it('decodes UTF-8 claim values in the JWT payload (not Latin-1)', () => {
    const token = makeUnsignedJwt({
      aal: 'aal2',
      email: 'tëst@example.com',
    });
    const claims = parseAbstrackAccessTokenClaims(token);
    expect(claims?.aal).toBe('aal2');
    expect(claims?.email).toBe('tëst@example.com');
  });

  it('returns null when neither atob nor Buffer is available', () => {
    const token = makeUnsignedJwt({ aal: 'aal2' });
    const atobDesc = Object.getOwnPropertyDescriptor(globalThis, 'atob');
    const bufferDesc = Object.getOwnPropertyDescriptor(globalThis, 'Buffer');
    try {
      // Stub away decoders (delete can be a no-op when non-configurable; defineProperty is reliable).
      Object.defineProperty(globalThis, 'atob', {
        value: undefined,
        configurable: true,
        enumerable: atobDesc?.enumerable ?? false,
        writable: true,
      });
      Object.defineProperty(globalThis, 'Buffer', {
        value: undefined,
        configurable: true,
        enumerable: bufferDesc?.enumerable ?? false,
        writable: true,
      });
      expect(parseAbstrackAccessTokenClaims(token)).toBeNull();
    } finally {
      if (atobDesc) {
        Object.defineProperty(globalThis, 'atob', atobDesc);
      } else {
        Reflect.deleteProperty(globalThis, 'atob');
      }
      if (bufferDesc) {
        Object.defineProperty(globalThis, 'Buffer', bufferDesc);
      } else {
        Reflect.deleteProperty(globalThis, 'Buffer');
      }
    }
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

  it('returns profile_error when profile lookup failed (even while profile is still undefined)', () => {
    const err = new Error('network');
    const gate = resolvePractitionerAppGate({
      hasSession: true,
      profile: undefined,
      profileError: err,
      accessTokenClaims: null,
    });
    expect(gate).toEqual({ kind: 'profile_error', error: err });
  });

  it('returns profile_missing when session exists but profile row is absent', () => {
    expect(
      resolvePractitionerAppGate({
        hasSession: true,
        profile: null,
        profileError: null,
        accessTokenClaims: { aal: 'aal2' },
      }),
    ).toEqual({ kind: 'profile_missing' });
  });

  it('returns profile_missing when app_role is not a canonical value', () => {
    expect(
      resolvePractitionerAppGate({
        hasSession: true,
        profile: { app_role: 'not_a_valid_role' },
        profileError: null,
        accessTokenClaims: null,
      }),
    ).toEqual({ kind: 'profile_missing' });
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
