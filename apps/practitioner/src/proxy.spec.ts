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
          set: jest.fn(
            (
              name: string,
              value: string,
              options?: Record<string, unknown>,
            ) => {
              jar.push({ name, value, options });
            },
          ),
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
          set: jest.fn(
            (
              name: string,
              value: string,
              options?: Record<string, unknown>,
            ) => {
              jar.push({ name, value, options });
            },
          ),
          getAll: jest.fn(() => [...jar]),
        },
      };
    }),
    rewrite: jest.fn((destination: string | URL) => ({
      type: 'rewrite',
      location:
        typeof destination === 'string' ? destination : destination.toString(),
    })),
  },
}));

describe('practitioner proxy', () => {
  const createServerClientMock = jest.mocked(createSupabaseServerClient);
  type ProxyRequest = Parameters<typeof proxy>[0];
  type ServerClient = ReturnType<typeof createSupabaseServerClient>;

  const makeRequest = (pathWithQuery: string) => {
    const path = pathWithQuery.startsWith('/')
      ? pathWithQuery
      : `/${pathWithQuery}`;
    const u = new URL(`https://practitioner.example.com${path}`);
    return {
      nextUrl: {
        pathname: u.pathname,
        search: u.search,
        searchParams: u.searchParams,
      },
      url: u.toString(),
      cookies: {
        getAll: jest.fn(() => []),
        set: jest.fn(),
      },
    } as unknown as ProxyRequest;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: null }, error: null })),
      },
    } as unknown as ServerClient);
  });

  it('rewrites /auth/callback without code to the fragment page for implicit auth', async () => {
    const result = await proxy(makeRequest('/auth/callback?next=%2F'));

    expect(createServerClientMock).not.toHaveBeenCalled();
    expect(result).toEqual(
      expect.objectContaining({
        type: 'rewrite',
        location:
          'https://practitioner.example.com/auth/callback/fragment?next=%2F',
      }),
    );
  });

  it('does not rewrite /auth/callback when code is present', async () => {
    await proxy(makeRequest('/auth/callback?code=abc&next=%2F'));

    expect(createServerClientMock).toHaveBeenCalled();
    const { NextResponse } = jest.requireMock('next/server');
    expect(NextResponse.rewrite).not.toHaveBeenCalled();
  });

  it('redirects signed-out root to /login', async () => {
    const result = await proxy(makeRequest('/'));

    expect(result).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://practitioner.example.com/login',
      }),
    );
  });

  it('redirects signed-in root to /patients', async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    } as unknown as ServerClient);

    const result = await proxy(makeRequest('/'));

    expect(result).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://practitioner.example.com/patients',
      }),
    );
  });

  it('redirects signed-in /login to /patients', async () => {
    createServerClientMock.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({
          data: { user: { id: 'user-1' } },
          error: null,
        })),
      },
    } as unknown as ServerClient);

    const result = await proxy(makeRequest('/login'));

    expect(result).toEqual(
      expect.objectContaining({
        type: 'redirect',
        location: 'https://practitioner.example.com/patients',
      }),
    );
  });
});
