import {
  isUnenrollAlreadyGoneError,
  looksLikeTotpSetupPayload,
  mapMfaUnenrollErrorToUserMessage,
  mapMfaVerifyErrorToUserMessage,
  normalizeTotpCode,
} from './mfa-user-messages';

describe('normalizeTotpCode', () => {
  it('strips non-digits and caps at six characters', () => {
    expect(normalizeTotpCode('12 34 56')).toBe('123456');
    expect(normalizeTotpCode('abc123456789')).toBe('123456');
  });

  it('returns empty when no digits are present', () => {
    expect(normalizeTotpCode('abc')).toBe('');
    expect(normalizeTotpCode('')).toBe('');
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

  it('maps invalid token text to not-valid copy', () => {
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

  it('maps mfa_verification_failed code when message is empty', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({
        message: '',
        code: 'mfa_verification_failed',
      }),
    ).toBe(
      'We could not verify that code yet. Please try again with a fresh code.',
    );
  });

  it('maps unknown non-empty message through verbatim when no keyword match', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({ message: 'Custom server text' }),
    ).toBe('Custom server text');
  });

  it('reads msg when message is absent', () => {
    expect(
      mapMfaVerifyErrorToUserMessage({ msg: 'invalid code', status: 500 }),
    ).toContain('not valid');
  });

  it('falls back to Error.message when object message is missing', () => {
    const err = new Error('invalid TOTP');
    expect(mapMfaVerifyErrorToUserMessage(err)).toContain('not valid');
  });

  it('maps totally empty error to wrong-code fallback', () => {
    expect(mapMfaVerifyErrorToUserMessage({})).toBe(wrongCode);
    expect(mapMfaVerifyErrorToUserMessage(null)).toBe(wrongCode);
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
