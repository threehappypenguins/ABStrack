import { getSameOriginLogoutPostFailure } from './same-origin-logout-post';

const BASE = 'https://practitioner.example.com/api/auth/logout';

function req(headers: Record<string, string>) {
  return {
    url: BASE,
    headers: new Headers(headers),
  };
}

describe('getSameOriginLogoutPostFailure', () => {
  it('returns null when Origin matches the request URL origin', () => {
    expect(
      getSameOriginLogoutPostFailure(
        req({ Origin: 'https://practitioner.example.com' }),
      ),
    ).toBeNull();
  });

  it('returns 403 when Origin is a different host', () => {
    expect(
      getSameOriginLogoutPostFailure(req({ Origin: 'https://evil.example' })),
    ).toEqual({ status: 403, error: 'Invalid Origin' });
  });

  it('returns 403 when Sec-Fetch-Site is cross-site', () => {
    expect(
      getSameOriginLogoutPostFailure(req({ 'Sec-Fetch-Site': 'cross-site' })),
    ).toEqual({ status: 403, error: 'Cross-site request rejected' });
  });

  it('returns null when Referer matches origin and Origin is absent', () => {
    expect(
      getSameOriginLogoutPostFailure(
        req({
          Referer: 'https://practitioner.example.com/login',
          'Sec-Fetch-Site': 'same-origin',
        }),
      ),
    ).toBeNull();
  });

  it('returns 403 when Referer origin does not match', () => {
    expect(
      getSameOriginLogoutPostFailure(
        req({
          Referer: 'https://evil.example/',
          'Sec-Fetch-Site': 'same-origin',
        }),
      ),
    ).toEqual({ status: 403, error: 'Invalid Referer' });
  });

  it('returns null when Origin is absent but Sec-Fetch-Site is same-origin', () => {
    expect(
      getSameOriginLogoutPostFailure(req({ 'Sec-Fetch-Site': 'same-origin' })),
    ).toBeNull();
  });

  it('returns 403 when Origin and Referer are absent and Sec-Fetch-Site is none', () => {
    expect(
      getSameOriginLogoutPostFailure(req({ 'Sec-Fetch-Site': 'none' })),
    ).toEqual({
      status: 403,
      error: 'Could not validate request origin',
    });
  });

  it('returns 403 when Origin and Referer are absent and Sec-Fetch-Site is same-site (strict same-origin)', () => {
    expect(
      getSameOriginLogoutPostFailure(req({ 'Sec-Fetch-Site': 'same-site' })),
    ).toEqual({
      status: 403,
      error: 'Could not validate request origin',
    });
  });
});
