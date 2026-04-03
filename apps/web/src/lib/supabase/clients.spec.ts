import { createBrowserClient } from './browser-client';
import { createServerClient } from './server-client';

const createBrowserClientMock = jest.fn<
  { kind: string },
  [string, string, Record<string, unknown>?]
>(() => ({ kind: 'browser-client' }));
const createServerClientMock = jest.fn<
  { kind: string },
  [string, string, Record<string, unknown>?]
>(() => ({ kind: 'server-client' }));
const cookiesMock = jest.fn(async () => ({
  getAll: jest.fn(() => []),
  set: jest.fn(),
}));

jest.mock('@supabase/ssr', () => ({
  createBrowserClient: (
    ...args: [string, string, Record<string, unknown>?]
  ) => createBrowserClientMock(...args),
  createServerClient: (
    ...args: [string, string, Record<string, unknown>?]
  ) => createServerClientMock(...args),
}));

jest.mock('next/headers', () => ({
  cookies: () => cookiesMock(),
}));

describe('web supabase clients env wiring', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    jest.clearAllMocks();
    process.env = {
      ...originalEnv,
      NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'publishable-key',
    };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('passes NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY to createBrowserClient', () => {
    createBrowserClient();

    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'publishable-key',
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
      'publishable-key',
      { cookies: cookieMethods },
    );
  });

  it('falls back to NEXT_PUBLIC_SUPABASE_ANON_KEY when publishable key is not set', () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy-anon-key';

    createBrowserClient();

    expect(createBrowserClientMock).toHaveBeenCalledWith(
      'https://example.supabase.co',
      'legacy-anon-key',
    );
  });

  it('throws clear errors when required env vars are missing', async () => {
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    expect(() => createBrowserClient()).toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_URL',
    );

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    expect(() => createBrowserClient()).toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    );

    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'publishable-key';

    await expect(
      createServerClient({
        getAll: () => [],
        setAll: () => undefined,
      }),
    ).rejects.toThrow('Missing NEXT_PUBLIC_SUPABASE_URL');

    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://example.supabase.co';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    await expect(
      createServerClient({
        getAll: () => [],
        setAll: () => undefined,
      }),
    ).rejects.toThrow(
      'Missing NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (or legacy NEXT_PUBLIC_SUPABASE_ANON_KEY)',
    );
  });
});
