import { POST } from './route';
import { createServerClient } from '../../../../lib/supabase/server-client';

jest.mock('../../../../lib/supabase/server-client', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    json: jest.fn((body: unknown, init?: { status?: number }) => ({
      type: 'json',
      body,
      status: init?.status ?? 200,
    })),
    redirect: jest.fn((url: URL, status?: number) => ({
      type: 'redirect',
      location: url.toString(),
      status,
      cookies: {
        set: jest.fn(),
      },
    })),
  },
}));

function logoutRequest(
  url: string,
  headers: Record<string, string> = { Origin: 'https://example.com' },
) {
  return {
    url,
    headers: new Headers(headers),
    nextUrl: new URL(url),
    cookies: {
      getAll: jest.fn(() => [{ name: 'sb-access-token', value: 'token' }]),
    },
  } as unknown as Parameters<typeof POST>[0];
}

describe('logout route', () => {
  const createServerClientMock = jest.mocked(createServerClient);
  type CookieMethodsArg = Parameters<typeof createServerClient>[0];
  type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns 403 and does not sign out when Origin is wrong', async () => {
    const response = await POST(
      logoutRequest('https://example.com/api/auth/logout', {
        Origin: 'https://evil.example',
      }),
    );

    expect(response).toEqual(
      expect.objectContaining({ type: 'json', status: 403 }),
    );
    expect(createServerClientMock).not.toHaveBeenCalled();
  });

  it('redirects to login and applies auth cookie updates to the response', async () => {
    let cookieMethods:
      | {
          getAll: () => Array<{ name: string; value: string }>;
          setAll?: (
            cookiesToSet: Array<{
              name: string;
              value: string;
              options?: Record<string, unknown>;
            }>,
          ) => void;
        }
      | undefined;

    const signOut = jest.fn(async () => {
      cookieMethods?.setAll?.([
        {
          name: 'sb-access-token',
          value: '',
          options: { maxAge: 0, path: '/' },
        },
      ]);
    });

    createServerClientMock.mockImplementation((methods: CookieMethodsArg) => {
      cookieMethods = methods;
      return Promise.resolve({
        auth: { signOut },
      } as unknown as ServerClient);
    });

    const response = await POST(
      logoutRequest('https://example.com/api/auth/logout'),
    );

    expect(createServerClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        getAll: expect.any(Function),
        setAll: expect.any(Function),
      }),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
    expect(signOut).toHaveBeenCalledWith(undefined);
    expect(response).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://example.com/login',
        status: 303,
      }),
    );
    expect(response.cookies.set).toHaveBeenCalledWith(
      'sb-access-token',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  it('passes global scope to signOut when scope=global is in the query string', async () => {
    const signOut = jest.fn(async () => undefined);

    createServerClientMock.mockImplementation(() =>
      Promise.resolve({
        auth: { signOut },
      } as unknown as ServerClient),
    );

    await POST(
      logoutRequest('https://example.com/api/auth/logout?scope=global'),
    );

    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });
});
