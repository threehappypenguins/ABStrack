import {
  USER_PASSWORD_SET_USER_METADATA_KEY,
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

  it('returns false when metadata flag is absent', () => {
    expect(userHasPasswordSignIn({ user_metadata: {} })).toBe(false);
  });
});
