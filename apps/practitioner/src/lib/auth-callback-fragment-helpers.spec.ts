import {
  interpretAuthCallbackGetUserProbe,
  parseImplicitHashParams,
} from './auth-callback-fragment-helpers';

describe('interpretAuthCallbackGetUserProbe', () => {
  it('treats AuthSessionMissingError as signed out (invalid link), not verification failed', () => {
    const err = Object.assign(new Error('Auth session missing!'), {
      name: 'AuthSessionMissingError',
    });
    expect(interpretAuthCallbackGetUserProbe(null, err)).toEqual({
      status: 'signed_out',
    });
  });

  it('treats other getUser errors as verification failed', () => {
    const err = new Error('network');
    expect(interpretAuthCallbackGetUserProbe(null, err)).toEqual({
      status: 'verification_failed',
      error: err,
    });
  });

  it('returns authenticated when user id is present', () => {
    expect(interpretAuthCallbackGetUserProbe({ id: 'user-1' }, null)).toEqual({
      status: 'authenticated',
      userId: 'user-1',
    });
  });

  it('returns signed out when user is absent without error', () => {
    expect(interpretAuthCallbackGetUserProbe(null, null)).toEqual({
      status: 'signed_out',
    });
  });
});

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
