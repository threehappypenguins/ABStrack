import { GET } from './route';
import { createServerClient } from '../../../lib/supabase/server-client';

jest.mock('../../../lib/supabase/server-client', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    redirect: jest.fn((url: URL) => ({
      type: 'redirect',
      location: url.toString(),
      cookies: { set: jest.fn() },
    })),
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      type: 'json',
      body,
      status: init?.status ?? 200,
    })),
  },
}));

describe('auth callback route', () => {
  const createServerClientMock = jest.mocked(createServerClient);
  type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
  type CallbackRequest = Parameters<typeof GET>[0];
  const expiredMessage =
    'This sign-in link is invalid or expired. Request a new one.';

  beforeEach(() => {
    jest.clearAllMocks();
    createServerClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn(async () => ({ error: null })),
      },
    } as unknown as ServerClient);
  });

  const makeRequest = (url: string): CallbackRequest => {
    const parsedUrl = new URL(url);
    return {
      url,
      nextUrl: {
        search: parsedUrl.search,
        searchParams: parsedUrl.searchParams,
      },
      cookies: {
        getAll: jest.fn(() => []),
        set: jest.fn(),
      },
    } as unknown as CallbackRequest;
  };

  it('redirects to the provided in-app path when next is safe and code is present', async () => {
    const response = await GET(
      makeRequest(
        'https://example.com/auth/callback?code=abc&next=/update-password?from=email',
      ),
    );

    expect(response).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://example.com/update-password?from=email',
      }),
    );
  });

  it('returns 400 when code is missing (implicit flow is handled in middleware)', async () => {
    const response = await GET(
      makeRequest('https://example.com/auth/callback?next=%2Fcaretaker%2Fjoin'),
    );

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        type: 'json',
        status: 400,
      }),
    );
  });

  it('redirects successfully when code exchange fails but an existing session is valid', async () => {
    const refreshSession = jest.fn(async () => ({
      data: { session: {} },
      error: null,
    }));
    createServerClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn(async () => ({
          error: { message: 'invalid grant' },
        })),
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
        refreshSession,
      },
    } as unknown as ServerClient);

    const response = await GET(
      makeRequest(
        'https://example.com/auth/callback?code=abc&next=/settings?tab=account',
      ),
    );
    const redirectUrl = new URL(response.location);

    expect(refreshSession).toHaveBeenCalled();
    expect(redirectUrl.pathname).toBe('/settings');
    expect(redirectUrl.searchParams.get('tab')).toBe('account');
    expect(redirectUrl.searchParams.get('error')).toBeNull();
  });

  it('redirects with an error when session exchange fails', async () => {
    createServerClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn(async () => ({
          error: { message: 'invalid grant' },
        })),
        getUser: jest.fn(async () => ({
          data: { user: null },
          error: null,
        })),
      },
    } as unknown as ServerClient);

    const response = await GET(
      makeRequest(
        'https://example.com/auth/callback?code=abc&next=/update-password?from=email',
      ),
    );
    const redirectUrl = new URL(response.location);

    expect(response).toEqual(expect.objectContaining({ type: 'redirect' }));
    expect(redirectUrl.pathname).toBe('/update-password');
    expect(redirectUrl.searchParams.get('from')).toBe('email');
    expect(redirectUrl.searchParams.get('error')).toBe(expiredMessage);
  });

  it('falls back to the default path for scheme-relative next values', async () => {
    const response = await GET(
      makeRequest('https://example.com/auth/callback?code=abc&next=//evil.com'),
    );

    expect(response).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://example.com/update-password',
      }),
    );
  });
});
