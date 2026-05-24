import { isPublicPractitionerPath } from './practitioner-public-paths';

describe('isPublicPractitionerPath', () => {
  it('matches exact public prefixes', () => {
    expect(isPublicPractitionerPath('/login')).toBe(true);
    expect(isPublicPractitionerPath('/invite')).toBe(true);
    expect(isPublicPractitionerPath('/update-password')).toBe(true);
    expect(isPublicPractitionerPath('/auth')).toBe(true);
  });

  it('matches nested paths under public prefixes', () => {
    expect(isPublicPractitionerPath('/invite/join')).toBe(true);
    expect(isPublicPractitionerPath('/auth/callback')).toBe(true);
  });

  it('returns false for authenticated app routes', () => {
    expect(isPublicPractitionerPath('/')).toBe(false);
    expect(isPublicPractitionerPath('/patients')).toBe(false);
    expect(isPublicPractitionerPath('/patients/abc')).toBe(false);
    expect(isPublicPractitionerPath('/settings')).toBe(false);
  });
});
