import { isPublicWebPath } from './web-public-paths';

describe('isPublicWebPath', () => {
  it('treats the marketing landing route as public', () => {
    expect(isPublicWebPath('/')).toBe(true);
  });

  it('matches exact public prefixes', () => {
    expect(isPublicWebPath('/login')).toBe(true);
    expect(isPublicWebPath('/signup')).toBe(true);
    expect(isPublicWebPath('/forgot-password')).toBe(true);
    expect(isPublicWebPath('/update-password')).toBe(true);
    expect(isPublicWebPath('/caretaker')).toBe(true);
    expect(isPublicWebPath('/auth')).toBe(true);
  });

  it('matches nested paths under public prefixes', () => {
    expect(isPublicWebPath('/login/reset')).toBe(true);
    expect(isPublicWebPath('/caretaker/join')).toBe(true);
    expect(isPublicWebPath('/auth/callback/fragment')).toBe(true);
  });

  it('returns false for authenticated app routes', () => {
    expect(isPublicWebPath('/dashboard')).toBe(false);
    expect(isPublicWebPath('/manage')).toBe(false);
    expect(isPublicWebPath('/insights')).toBe(false);
    expect(isPublicWebPath('/settings')).toBe(false);
  });

  it('returns false for lookalike paths that do not match a prefix boundary', () => {
    expect(isPublicWebPath('/logins')).toBe(false);
    expect(isPublicWebPath('/login-evil')).toBe(false);
    expect(isPublicWebPath('/auths')).toBe(false);
  });
});
