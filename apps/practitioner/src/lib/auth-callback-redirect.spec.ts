import { getSafePractitionerAuthCallbackRedirectPath } from './auth-callback-redirect';
import { PRACTITIONER_INVITE_JOIN_PATH } from './practitioner-invite-join';

describe('getSafePractitionerAuthCallbackRedirectPath', () => {
  it('returns invite join path for unsafe next', () => {
    expect(getSafePractitionerAuthCallbackRedirectPath('//evil')).toBe(
      PRACTITIONER_INVITE_JOIN_PATH,
    );
  });

  it('allows /invite/join as next', () => {
    expect(getSafePractitionerAuthCallbackRedirectPath('/invite/join')).toBe(
      '/invite/join',
    );
  });
});
