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
      cookies: {
        set: jest.fn(),
      },
    })),
  },
}));

describe('auth callback route', () => {
  const createServerClientMock = jest.mocked(createServerClient);
  type ServerClient = Awaited<ReturnType<typeof createServerClient>>;
  type CallbackRequest = Parameters<typeof GET>[0];
  const expiredMessage =
    'This reset link is invalid or expired. Request a new one.';

  beforeEach(() => {
    jest.clearAllMocks();
    createServerClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn(async () => ({ error: null })),
      },
    } as unknown as ServerClient);
  });

  const makeRequest = (url: string): CallbackRequest =>
    {
      const parsedUrl = new URL(url);
      return {
        url,
        nextUrl: {
          searchParams: parsedUrl.searchParams,
        },
        cookies: {
          getAll: jest.fn(() => []),
          set: jest.fn(),
        },
      } as unknown as CallbackRequest;
    };

  it('redirects to the provided in-app path when next is safe', async () => {
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

  it('redirects with an error when the callback is missing a code', async () => {
    const response = await GET(
      makeRequest('https://example.com/auth/callback?next=/update-password'),
    );
    const redirectUrl = new URL(response.location);

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(response).toEqual(expect.objectContaining({ type: 'redirect' }));
    expect(redirectUrl.pathname).toBe('/update-password');
    expect(redirectUrl.searchParams.get('error')).toBe(expiredMessage);
  });

  it('redirects with an error when session exchange fails', async () => {
    createServerClientMock.mockResolvedValue({
      auth: {
        exchangeCodeForSession: jest.fn(async () => ({
          error: { message: 'invalid grant' },
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