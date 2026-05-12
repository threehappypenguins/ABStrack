import { parseImplicitHashParams } from './auth-callback-fragment-helpers';

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
