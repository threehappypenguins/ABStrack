import {
  AUTH_PASSWORD_MAX_LENGTH,
  AUTH_PASSWORD_MIN_LENGTH,
  USER_PASSWORD_SET_USER_METADATA_KEY,
  buildRevokedPasswordPlaceholder,
  clampAuthPasswordInput,
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

describe('clampAuthPasswordInput', () => {
  it('passes through values within the UTF-8 byte limit', () => {
    expect(clampAuthPasswordInput('a'.repeat(72))).toBe('a'.repeat(72));
    expect(clampAuthPasswordInput('😀'.repeat(18))).toBe('😀'.repeat(18));
  });

  it('truncates values that exceed 72 UTF-8 bytes', () => {
    const clamped = clampAuthPasswordInput('😀'.repeat(19));
    expect(getAuthPasswordUtf8ByteLength(clamped)).toBeLessThanOrEqual(
      AUTH_PASSWORD_MAX_LENGTH,
    );
    expect(getAuthPasswordValidationError(clamped)).toBeNull();
    expect(clamped).toBe('😀'.repeat(18));
  });

  it('drops whole astral symbols instead of leaving surrogate halves', () => {
    const over = `${'a'.repeat(71)}😀`;
    expect(getAuthPasswordUtf8ByteLength(over)).toBeGreaterThan(
      AUTH_PASSWORD_MAX_LENGTH,
    );

    const clamped = clampAuthPasswordInput(over);

    expect(clamped).toBe('a'.repeat(71));
    expect(clamped).not.toContain('\uFFFD');
    expect(getAuthPasswordUtf8ByteLength(clamped)).toBe(71);
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
