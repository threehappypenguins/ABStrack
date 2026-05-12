import {
  AUTH_CALLBACK_INVALID_LINK_MESSAGE,
  getSafeAuthCallbackRedirectPath,
} from './auth-callback-redirect';

describe('getSafeAuthCallbackRedirectPath', () => {
  it('returns the provided in-app path when next is safe', () => {
    expect(getSafeAuthCallbackRedirectPath('/update-password?from=email')).toBe(
      '/update-password?from=email',
    );
  });

  it('falls back to the default path when next is missing', () => {
    expect(getSafeAuthCallbackRedirectPath(null)).toBe('/update-password');
  });

  it('falls back to the default path for scheme-relative next values', () => {
    expect(getSafeAuthCallbackRedirectPath('//evil.com')).toBe(
      '/update-password',
    );
  });
});

describe('AUTH_CALLBACK_INVALID_LINK_MESSAGE', () => {
  it('is a non-empty user-facing string', () => {
    expect(AUTH_CALLBACK_INVALID_LINK_MESSAGE.length).toBeGreaterThan(10);
  });
});
