import {
  AUTH_PASSWORD_MAX_LENGTH,
  USER_PASSWORD_SET_USER_METADATA_KEY,
  buildRevokedPasswordPlaceholder,
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

describe('buildRevokedPasswordPlaceholder', () => {
  it('stays within the bcrypt / GoTrue password length limit', () => {
    const password = buildRevokedPasswordPlaceholder();
    expect(password.length).toBeLessThanOrEqual(AUTH_PASSWORD_MAX_LENGTH);
    expect(password.length).toBeGreaterThanOrEqual(8);
    expect(password.startsWith('Abstrack-revoked-')).toBe(true);
    expect(password.endsWith('!9')).toBe(true);
  });
});
