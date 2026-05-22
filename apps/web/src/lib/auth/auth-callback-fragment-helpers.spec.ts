import {
  isSupabaseAuthApiError,
  parseImplicitHashParams,
} from './auth-callback-fragment-helpers';

describe('parseImplicitHashParams', () => {
  it('parses access_token and refresh_token from a Supabase-style hash', () => {
    const hash =
      '#access_token=at&refresh_token=rt&expires_in=3600&token_type=bearer';
    expect(parseImplicitHashParams(hash)).toEqual({
      access_token: 'at',
      refresh_token: 'rt',
      expires_in: '3600',
      token_type: 'bearer',
    });
  });
});

describe('isSupabaseAuthApiError', () => {
  it('returns true for Supabase Auth API errors', () => {
    expect(
      isSupabaseAuthApiError({
        __isAuthError: true,
        message: 'Network error',
      }),
    ).toBe(true);
  });

  it('returns false for ordinary errors', () => {
    expect(isSupabaseAuthApiError(new Error('nope'))).toBe(false);
  });
});
