import { getSafePractitionerAuthCallbackRedirectPath } from './auth-callback-redirect';

describe('getSafePractitionerAuthCallbackRedirectPath', () => {
  it('returns / for unsafe next', () => {
    expect(getSafePractitionerAuthCallbackRedirectPath('//evil')).toBe('/');
  });
});
