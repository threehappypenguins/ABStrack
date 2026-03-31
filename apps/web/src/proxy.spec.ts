import proxy from './proxy';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

jest.mock('@abstrack/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock('next/server', () => ({
  __esModule: true,
  NextResponse: {
    next: jest.fn(() => {
      const jar: Array<{
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }> = [];
      return {
        type: 'next',
        cookies: {
          set: jest.fn((name: string, value: string, options?: Record<string, unknown>) => {
            jar.push({ name, value, options });
          }),
          getAll: jest.fn(() => [...jar]),
        },
      };
    }),
    redirect: jest.fn((url: URL) => {
      const jar: Array<{
        name: string;
        value: string;
        options?: Record<string, unknown>;
      }> = [];
      return {
        type: 'redirect',
        location: url.toString(),
        cookies: {
          set: jest.fn((name: string, value: string, options?: Record<string, unknown>) => {
            jar.push({ name, value, options });
          }),
          getAll: jest.fn(() => [...jar]),
        },
      };
    }),
  },
}));

describe('web auth proxy', () => {
  const createSupabaseServerClientMock = jest.mocked(createSupabaseServerClient);

  const makeRequest = (pathname: string) => {
    const cookies = {
      getAll: jest.fn(() => []),
      set: jest.fn(),
    };

    return {
      nextUrl: { pathname },
      url: `https://example.com${pathname}`,
      cookies,
    } as any;
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('redirects unauthenticated user from protected route to /login', async () => {
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

    createSupabaseServerClientMock.mockImplementation((methods: any) => {
      cookieMethods = methods;
      return {
        auth: {
          getUser: jest.fn(async () => {
            cookieMethods?.setAll?.([
              {
                name: 'sb-refresh-token',
                value: '',
                options: { maxAge: 0, path: '/' },
              },
            ]);

            return { data: { user: null } };
          }),
        },
      } as any;
    });

    const result = await proxy(makeRequest('/dashboard/patients'));

    expect(result).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://example.com/login',
      }),
    );
    expect(result.cookies.set).toHaveBeenCalledWith(
      'sb-refresh-token',
      '',
      expect.objectContaining({ maxAge: 0, path: '/' }),
    );
  });

  it('redirects authenticated user away from /login to /', async () => {
    createSupabaseServerClientMock.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })),
      },
    } as any);

    const result = await proxy(makeRequest('/login'));

    expect(result).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://example.com/',
      }),
    );
  });

  it('refreshes session via getUser and allows request when route is public', async () => {
    const getUser = jest.fn(async () => ({ data: { user: null } }));

    createSupabaseServerClientMock.mockReturnValue({
      auth: { getUser },
    } as any);

    const result = await proxy(makeRequest('/'));

    expect(createSupabaseServerClientMock).toHaveBeenCalledTimes(1);
    expect(createSupabaseServerClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        getAll: expect.any(Function),
        setAll: expect.any(Function),
      }),
    );
    expect(getUser).toHaveBeenCalledTimes(1);
    expect(result).toEqual(
      expect.objectContaining({
        type: 'next',
      }),
    );
  });
});
