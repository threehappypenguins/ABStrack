import { normalizeEmailForLookup } from './resolve-auth-user-id-by-email';

describe('normalizeEmailForLookup', () => {
  it('trims and lowercases', () => {
    expect(normalizeEmailForLookup('  User@EXAMPLE.COM \t')).toBe(
      'user@example.com',
    );
  });

  it('returns empty string for whitespace-only', () => {
    expect(normalizeEmailForLookup('   ')).toBe('');
  });
});
