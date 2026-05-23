import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  USER_PASSWORD_SET_USER_METADATA_KEY,
  buildRevokedPasswordPlaceholder,
  getAuthPasswordUtf8ByteLength,
  getAuthPasswordValidationError,
  userHasPasswordSignIn,
} from './user-password-sign-in';

describe('userHasPasswordSignIn', () => {
  it('returns true when metadata flag is set', () => {
    expect(
      userHasPasswordSignIn({
        user_metadata: { [USER_PASSWORD_SET_USER_METADATA_KEY]: true },
      }),
    ).toBe(true);
  });

  it('returns false when metadata flag is absent or explicitly false', () => {
    expect(userHasPasswordSignIn({ user_metadata: {} })).toBe(false);
    expect(
      userHasPasswordSignIn({
        user_metadata: { [USER_PASSWORD_SET_USER_METADATA_KEY]: false },
      }),
    ).toBe(false);
  });
});

describe('getAuthPasswordUtf8ByteLength', () => {
  it('counts UTF-8 bytes, not JavaScript string length', () => {
    expect(getAuthPasswordUtf8ByteLength('a'.repeat(72))).toBe(72);
    expect(getAuthPasswordUtf8ByteLength('é')).toBe(2);
    expect(getAuthPasswordUtf8ByteLength('😀')).toBe(4);
  });
});

describe('getAuthPasswordValidationError', () => {
  it('returns null for an acceptable ASCII password', () => {
    expect(getAuthPasswordValidationError('a'.repeat(12))).toBeNull();
  });

  it('rejects passwords shorter than the minimum', () => {
    expect(getAuthPasswordValidationError('short')).toContain('at least');
  });

  it('rejects passwords longer than 72 UTF-8 bytes', () => {
    expect(getAuthPasswordValidationError('😀'.repeat(19))).toContain('bytes');
  });
});

describe('buildRevokedPasswordPlaceholder', () => {
  it('stays within the bcrypt / GoTrue password length limit', () => {
    const password = buildRevokedPasswordPlaceholder();
    expect(password.length).toBeLessThanOrEqual(AUTH_PASSWORD_MAX_LENGTH);
    expect(password.length).toBeGreaterThanOrEqual(AUTH_PASSWORD_MIN_LENGTH);
    expect(getAuthPasswordUtf8ByteLength(password)).toBeLessThanOrEqual(
      AUTH_PASSWORD_MAX_LENGTH,
    );
    expect(password.startsWith('Abstrack-revoked-')).toBe(true);
    expect(password.endsWith('!9')).toBe(true);
  });
});
