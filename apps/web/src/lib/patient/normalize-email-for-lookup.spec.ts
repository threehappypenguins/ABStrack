import { normalizeEmailForLookup } from './normalize-email-for-lookup';

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
