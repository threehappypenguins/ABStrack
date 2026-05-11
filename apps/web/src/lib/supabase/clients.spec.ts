import { createBrowserClient } from './browser-client';
import { createServerClient } from './server-client';

type TestCookie = {
  name: string;
  value: string;
  options?: Record<string, unknown>;
};

const createBrowserClientMock = jest.fn<
  { kind: string },
  [string, string, Record<string, unknown>?]
>(() => ({ kind: 'browser-client' }));
const createServerClientMock = jest.fn<
  { kind: string },
  [string, string, Record<string, unknown>?]
>(() => ({ kind: 'server-client' }));
const cookieStore = {
  getAll: jest.fn<TestCookie[], []>(() => []),
  set: jest.fn<void, [string, string, Record<string, unknown>?]>(),
};
const cookiesMock = jest.fn(async () => cookieStore);

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: (...args: [string, string, Record<string, unknown>?]) =>
    createBrowserClientMock(...args),
  createServerClient: (...args: [string, string, Record<string, unknown>?]) =>
    createServerClientMock(...args),
}));

jest.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

describe('web supabase clients env wiring', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    cookieStore.getAll.mockReturnValue([]);
    cookieStore.set.mockImplementation(() => undefined);
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test_jest_fixture',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to createBrowserClient', () => {
    createBrowserClient();

    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test_jest_fixture',
    );
  });

  it('passes NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to createServerClient', async () => {
    const cookieMethods = {
      getAll: jest.fn(() => []),
      setAll: jest.fn(),
    };

    await createServerClient(cookieMethods);

    expect(createServerClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test_jest_fixture',
      { cookies: cookieMethods },
    );
  });

  it('uses next headers cookies store when createServerClient is called without cookie methods', async () => {
    cookieStore.getAll.mockReturnValue([
      { name: 'sb-auth-token', value: 'token' },
    ]);

    await createServerClient();

    expect(cookiesMock).toHaveBeenCalledTimes(1);
    expect(createServerClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'sb_publishable_test_jest_fixture',
      {
        cookies: expect.objectContaining({
          getAll: expect.any(Function),
          setAll: expect.any(Function),
        }),
      },
    );

    const cookiesArg = createServerClientMock.mock.calls[0]?.[2]?.cookies as {
      getAll: () => Array<{ name: string; value: string }>;
      setAll: (
        values: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>,
      ) => void;
    };

    expect(cookiesArg.getAll()).toEqual([
      { name: 'sb-auth-token', value: 'token' },
    ]);
    expect(cookieStore.getAll).toHaveBeenCalledTimes(1);

    cookiesArg.setAll([
      {
        name: 'sb-auth-token',
        value: 'new-token',
        options: { path: '/' },
      },
    ]);

    expect(cookieStore.set).toHaveBeenCalledWith('sb-auth-token', 'new-token', {
      path: '/',
    });
  });

  it('swallows cookie write failures in the implicit next headers path', async () => {
    const writeError = new Error('read only cookies');
    cookieStore.set.mockImplementation(() => {
      throw writeError;
    });

    await createServerClient();

    const cookiesArg = createServerClientMock.mock.calls[0]?.[2]?.cookies as {
      setAll: (
        values: Array<{
          name: string;
          value: string;
          options?: Record<string, unknown>;
        }>,
      ) => void;
    };

    expect(() =>
      cookiesArg.setAll([
        {
          name: 'sb-auth-token',
          value: 'new-token',
          options: { path: '/' },
        },
      ]),
    ).not.toThrow();
  });

  it('throws clear errors when required env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createBrowserClient()).toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_URL',
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    expect(() => createBrowserClient()).toThrow(
      /Missing Supabase publishable key/,
    );

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY =
      'sb_publishable_test_jest_fixture';

    await expect(
      createServerClient({
        getAll: () => [],
        setAll: () => undefined,
      }),
    ).rejects.toThrow('Missing NEXT_PUBLIC_SUPABASE_URL');

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

    await expect(
      createServerClient({
        getAll: () => [],
        setAll: () => undefined,
      }),
    ).rejects.toThrow(/Missing Supabase publishable key/);
  });

  it('rejects a secret-looking publishable env value', () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_secret_default';
    expect(() => createBrowserClient()).toThrow(/secret key/);
  });
});
