import { GET } from './route';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

jest.mock('@abstrack/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
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

describe('practitioner auth callback route', () => {
  const createServerClientMock = jest.mocked(createSupabaseServerClient);
  type ServerClient = ReturnType<typeof createSupabaseServerClient>;
  type CallbackRequest = Parameters<typeof GET>[0];
  const expiredMessage =
    'This sign-in link is invalid or expired. Request a new one.';

  beforeEach(() => {
    jest.clearAllMocks();
    createServerClientMock.mockReturnValue({
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
      makeRequest('https://example.com/auth/callback?code=abc&next=/'),
    );

    expect(response).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://example.com/',
      }),
    );
  });

  it('returns 400 when code is missing (implicit flow is handled in proxy)', async () => {
    const response = await GET(
      makeRequest('https://example.com/auth/callback?next=%2F'),
    );

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        type: 'json',
        status: 400,
      }),
    );
  });

  it('redirects with an error when session exchange fails', async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        exchangeCodeForSession: jest.fn(async () => ({
          error: { message: 'invalid grant' },
        })),
      },
    } as unknown as ServerClient);

    const response = await GET(
      makeRequest('https://example.com/auth/callback?code=abc&next=/'),
    );
    const redirectUrl = new URL((response as { location: string }).location);

    expect(response).toEqual(expect.objectContaining({ type: 'redirect' }));
    expect(redirectUrl.pathname).toBe('/');
    expect(redirectUrl.searchParams.get('error')).toBe(expiredMessage);
  });
});
