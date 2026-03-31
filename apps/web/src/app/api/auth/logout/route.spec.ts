import { POST } from './route';
import { createSupabaseServerClient } from '@abstrack/supabase/server';

jest.mock('@abstrack/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
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
  const createSupabaseServerClientMock = jest.mocked(createSupabaseServerClient);

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

    createSupabaseServerClientMock.mockImplementation((methods: any) => {
      cookieMethods = methods;
      return {
        auth: { signOut },
      } as any;
    });

    const request = {
      url: 'https://example.com/api/auth/logout',
      cookies: {
        getAll: jest.fn(() => [{ name: 'sb-access-token', value: 'token' }]),
      },
    } as any;

    const response = await POST(request);

    expect(createSupabaseServerClientMock).toHaveBeenCalledWith(
      expect.objectContaining({
        getAll: expect.any(Function),
        setAll: expect.any(Function),
      }),
    );
    expect(signOut).toHaveBeenCalledTimes(1);
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
});