import { POST } from './route';
import { createServerClient } from '../../../../lib/supabase/server-client';

jest.mock('../../../../lib/supabase/server-client', () => ({
  createServerClient: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
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

describe('logout route', () => {
  const createServerClientMock = jest.mocked(createServerClient);
  type CookieMethodsArg = Parameters<typeof createServerClient>[0];
  type ServerClient = Awaited<ReturnType<typeof createServerClient>>;

  beforeEach(() => {
    jest.clearAllMocks();
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

    const request = {
      url: 'https://example.com/api/auth/logout',
      nextUrl: new URL('https://example.com/api/auth/logout'),
      cookies: {
        getAll: jest.fn(() => [{ name: 'sb-access-token', value: 'token' }]),
      },
    } as unknown as Parameters<typeof POST>[0];

    const response = await POST(request);

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

    const request = {
      url: 'https://example.com/api/auth/logout?scope=global',
      nextUrl: new URL('https://example.com/api/auth/logout?scope=global'),
      cookies: {
        getAll: jest.fn(() => []),
      },
    } as unknown as Parameters<typeof POST>[0];

    await POST(request);

    expect(signOut).toHaveBeenCalledWith({ scope: 'global' });
  });
});
