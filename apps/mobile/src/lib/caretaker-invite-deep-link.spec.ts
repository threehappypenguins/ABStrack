import {
  isAbstrackCaretakerInviteUrl,
  isCaretakerInviteLinkUrl,
  isHttpsCaretakerInviteUrl,
  isHttpsCaretakerJoinWithoutCodeUrl,
  normalizeUserWebOrigin,
} from './caretaker-invite-deep-link';

describe('normalizeUserWebOrigin', () => {
  it('returns origin for https URL', () => {
    expect(normalizeUserWebOrigin('https://app.example.com')).toBe(
      'https://app.example.com',
    );
  });

  it('returns origin when scheme omitted', () => {
    expect(normalizeUserWebOrigin('app.example.com')).toBe(
      'https://app.example.com',
    );
  });

  it('returns null for empty', () => {
    expect(normalizeUserWebOrigin('')).toBeNull();
    expect(normalizeUserWebOrigin(undefined)).toBeNull();
  });
});

describe('isAbstrackCaretakerInviteUrl', () => {
  it('matches caretaker-invite path', () => {
    expect(
      isAbstrackCaretakerInviteUrl('abstrack:///caretaker-invite?code=x'),
    ).toBe(true);
  });

  it('rejects other abstrack paths', () => {
    expect(isAbstrackCaretakerInviteUrl('abstrack:///signup?code=x')).toBe(
      false,
    );
  });
});

describe('isHttpsCaretakerInviteUrl', () => {
  it('matches auth callback with caretaker next', () => {
    expect(
      isHttpsCaretakerInviteUrl(
        'https://app.example.com/auth/callback?code=abc&next=%2Fcaretaker%2Fjoin',
        'https://app.example.com',
      ),
    ).toBe(true);
  });

  it('rejects wrong origin', () => {
    expect(
      isHttpsCaretakerInviteUrl(
        'https://evil.com/auth/callback?code=abc&next=/caretaker/join',
        'https://app.example.com',
      ),
    ).toBe(false);
  });

  it('rejects auth callback for password recovery next', () => {
    expect(
      isHttpsCaretakerInviteUrl(
        'https://app.example.com/auth/callback?code=abc&next=%2Fupdate-password',
        'https://app.example.com',
      ),
    ).toBe(false);
  });

  it('rejects when env origin unset', () => {
    expect(
      isHttpsCaretakerInviteUrl(
        'https://app.example.com/auth/callback?code=abc&next=/caretaker/join',
        undefined,
      ),
    ).toBe(false);
  });
});

describe('isHttpsCaretakerJoinWithoutCodeUrl', () => {
  it('matches /caretaker/join without code on allowed origin', () => {
    expect(
      isHttpsCaretakerJoinWithoutCodeUrl(
        'https://app.example.com/caretaker/join',
        'https://app.example.com',
      ),
    ).toBe(true);
  });

  it('rejects /caretaker/join when code is present', () => {
    expect(
      isHttpsCaretakerJoinWithoutCodeUrl(
        'https://app.example.com/caretaker/join?code=x',
        'https://app.example.com',
      ),
    ).toBe(false);
  });

  it('rejects wrong origin', () => {
    expect(
      isHttpsCaretakerJoinWithoutCodeUrl(
        'https://evil.com/caretaker/join',
        'https://app.example.com',
      ),
    ).toBe(false);
  });
});

describe('isCaretakerInviteLinkUrl', () => {
  it('combines abstrack and https', () => {
    expect(
      isCaretakerInviteLinkUrl(
        'abstrack:///caretaker-invite?code=x',
        'https://app.example.com',
      ),
    ).toBe(true);
    expect(
      isCaretakerInviteLinkUrl(
        'https://app.example.com/auth/callback?code=a&next=/caretaker/join',
        'https://app.example.com',
      ),
    ).toBe(true);
    expect(
      isCaretakerInviteLinkUrl(
        'https://app.example.com/caretaker/join',
        'https://app.example.com',
      ),
    ).toBe(false);
  });
});
