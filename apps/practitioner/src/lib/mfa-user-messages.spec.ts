import {
  getVerificationMessage,
  isUnenrollAlreadyGoneError,
  looksLikeTotpSetupPayload,
  mapMfaUnenrollErrorToUserMessage,
  mapMfaVerifyErrorToUserMessage,
  readAuthLikeError,
} from './mfa-user-messages';

describe('readAuthLikeError', () => {
  it('reads string errors', () => {
    expect(readAuthLikeError('network failed')).toEqual({
      message: 'network failed',
    });
  });

  it('reads AuthApiError-like object with message and status', () => {
    expect(
      readAuthLikeError({ message: 'bad', status: 422, code: 'x' }),
    ).toEqual({ message: 'bad', status: 422, code: 'x' });
  });

  it('maps msg when message is absent', () => {
    expect(readAuthLikeError({ msg: 'alt', status: 400 })).toEqual({
      message: 'alt',
      status: 400,
      code: undefined,
    });
  });

  /** GoTrue sometimes returns 422 with an empty body — client may surface empty `message`. */
  it('preserves status when message is empty (422 MFA verify)', () => {
    expect(readAuthLikeError({ message: '', status: 422 })).toEqual({
      message: '',
      status: 422,
      code: undefined,
    });
  });

  it('falls back to Error.message when object message is missing', () => {
    const err = new Error('thrown');
    (err as unknown as { status: number }).status = 500;
    expect(readAuthLikeError(err)).toMatchObject({
      message: 'thrown',
      status: 500,
    });
  });
});

describe('mapMfaVerifyErrorToUserMessage', () => {
  const wrongCode =
    'That code did not match. Enter the current six-digit code from your authenticator.';
  const sessionExpired =
    'Your session may have expired. Sign in again, then retry verification.';

  it('maps 422 with empty message to wrong-code copy', () => {
    expect(mapMfaVerifyErrorToUserMessage({ message: '', status: 422 })).toBe(
      wrongCode,
    );
  });

  it('maps 400 with empty message to wrong-code copy', () => {
    expect(mapMfaVerifyErrorToUserMessage({ status: 400, message: '' })).toBe(
      wrongCode,
    );
  });

  it('maps 401 to session copy', () => {
    expect(mapMfaVerifyErrorToUserMessage({ status: 401, message: 'x' })).toBe(
      sessionExpired,
    );
  });

  it('maps invalid token text via getVerificationMessage', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({
        message: 'invalid TOTP',
        status: 500,
      }),
    ).toContain('not valid');
  });

  it('maps expired challenge text', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({
        message: 'Challenge expired',
        status: 500,
      }),
    ).toContain('expired');
  });

  it('maps mfa_verification_failed code', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({
        message: '',
        code: 'mfa_verification_failed',
      }),
    ).toBe(
      'We could not verify that code yet. Please try again with a fresh code.',
    );
  });

  it('maps unknown non-empty message through getVerificationMessage', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({ message: 'Custom server text' }),
    ).toBe('Custom server text');
  });

  it('maps totally empty error to wrong-code fallback', () => {
    expect(mapMfaVerifyErrorToUserMessage({})).toBe(wrongCode);
    expect(mapMfaVerifyErrorToUserMessage(null)).toBe(wrongCode);
  });
});

describe('looksLikeTotpSetupPayload', () => {
  it('detects otpauth URI', () => {
    expect(
      looksLikeTotpSetupPayload(
        'otpauth://totp/Issuer:u@e?secret=XXX&issuer=Y',
      ),
    ).toBe(true);
  });

  it('detects secret= and issuer= fragments', () => {
    expect(looksLikeTotpSetupPayload('secret=JBSWY3DPEHPK3PXP')).toBe(true);
    expect(looksLikeTotpSetupPayload('issuer=ABStrack')).toBe(true);
  });

  it('detects ://…totp path', () => {
    expect(looksLikeTotpSetupPayload('foo://x/totp/y')).toBe(true);
  });

  it('allows plain six-digit codes', () => {
    expect(looksLikeTotpSetupPayload('123456')).toBe(false);
    expect(looksLikeTotpSetupPayload('12 34 56')).toBe(false);
  });
});

describe('getVerificationMessage', () => {
  it('maps expired and invalid substrings', () => {
    expect(getVerificationMessage('Code expired')).toContain('expired');
    expect(getVerificationMessage('invalid code')).toContain('not valid');
  });

  it('returns trimmed message when no keyword match', () => {
    expect(getVerificationMessage('  hello  ')).toBe('hello');
  });

  it('falls back when empty', () => {
    expect(getVerificationMessage('')).toContain('We could not verify');
    expect(getVerificationMessage(undefined)).toContain('We could not verify');
  });
});

describe('isUnenrollAlreadyGoneError', () => {
  it('treats 404 and 410 as gone', () => {
    expect(isUnenrollAlreadyGoneError({ status: 404, message: 'nope' })).toBe(
      true,
    );
    expect(isUnenrollAlreadyGoneError({ status: 410, message: 'gone' })).toBe(
      true,
    );
  });

  it('detects not found in message', () => {
    expect(isUnenrollAlreadyGoneError({ message: 'Factor not found' })).toBe(
      true,
    );
  });

  it('returns false for other server errors', () => {
    expect(
      isUnenrollAlreadyGoneError({ status: 500, message: 'db down' }),
    ).toBe(false);
  });
});

describe('mapMfaUnenrollErrorToUserMessage', () => {
  it('maps 401 to session copy', () => {
    expect(mapMfaUnenrollErrorToUserMessage({ status: 401 })).toContain(
      'session',
    );
  });

  it('maps other errors to generic copy', () => {
    expect(mapMfaUnenrollErrorToUserMessage({ status: 503 })).toContain(
      'Could not cancel',
    );
  });
});
