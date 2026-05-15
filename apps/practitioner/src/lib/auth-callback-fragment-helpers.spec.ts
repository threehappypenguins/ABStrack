import { parseImplicitHashParams } from './auth-callback-fragment-helpers';

describe('parseImplicitHashParams', () => {
  it('parses access_token and refresh_token from a typical invite hash', () => {
    const hash =
      '#access_token=atok&expires_at=1&expires_in=3600&refresh_token=rtok&token_type=bearer&type=invite';
    expect(parseImplicitHashParams(hash)).toMatchObject({
      access_token: 'atok',
      refresh_token: 'rtok',
    });
  });

  it('accepts fragment without leading #', () => {
    expect(
      parseImplicitHashParams('access_token=a&refresh_token=b'),
    ).toMatchObject({
      access_token: 'a',
      refresh_token: 'b',
    });
  });
});
