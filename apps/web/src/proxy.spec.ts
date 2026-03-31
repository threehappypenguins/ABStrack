import proxy from './proxy';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

jest.mock('@abstrack/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
}));

jest.mock('next/server', () => ({
  NextResponse: {
    next: jest.fn(() => ({ type: 'next', cookies: { set: jest.fn() } })),
    redirect: jest.fn((url: URL) => ({
      type: 'redirect',
      location: url.toString(),
    })),
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
    createSupabaseServerClientMock.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: null } })),
      },
    } as any);

    const result = await proxy(makeRequest('/dashboard/patients'));

    expect(result).toEqual({
      type: 'redirect',
      location: 'https://example.com/login',
    });
  });

  it('redirects authenticated user away from /login to /', async () => {
    createSupabaseServerClientMock.mockReturnValue({
      auth: {
        getUser: jest.fn(async () => ({ data: { user: { id: 'user-1' } } })),
      },
    } as any);

    const result = await proxy(makeRequest('/login'));

    expect(result).toEqual({
      type: 'redirect',
      location: 'https://example.com/',
    });
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
