import { createSupabaseServerClient } from '@abstrack/supabase/server';
import { POST } from './route';
import type { NextRequest } from 'next/server';

jest.mock('@abstrack/supabase/server', () => ({
  createSupabaseServerClient: jest.fn(),
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
      cookies: { set: jest.fn() },
    })),
  },
}));

const mockedCreate = jest.mocked(createSupabaseServerClient);

describe('POST /api/auth/logout', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedCreate.mockReturnValue({
      auth: {
        signOut: jest.fn().mockResolvedValue(undefined),
      },
    } as never);
  });

  it('returns 403 and does not sign out when Origin is wrong', async () => {
    const request = {
      url: 'https://practitioner.example.com/api/auth/logout',
      headers: new Headers({
        Origin: 'https://evil.example',
      }),
      cookies: { getAll: jest.fn(() => []) },
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(response).toEqual(
      expect.objectContaining({ type: 'json', status: 403 }),
    );
    expect(mockedCreate).not.toHaveBeenCalled();
  });

  it('redirects and signs out when Origin matches', async () => {
    const request = {
      url: 'https://practitioner.example.com/api/auth/logout',
      headers: new Headers({
        Origin: 'https://practitioner.example.com',
      }),
      cookies: { getAll: jest.fn(() => []) },
    } as unknown as NextRequest;

    const response = await POST(request);

    expect(mockedCreate).toHaveBeenCalled();
    expect(response).toEqual(
      expect.objectContaining({
        type: 'redirect',
        status: 303,
        location: expect.stringContaining('/login'),
      }),
    );
  });
});
