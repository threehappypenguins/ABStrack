import { mapSupabaseSessionToAuthContext } from './auth-provider-session';

describe('mapSupabaseSessionToAuthContext', () => {
  it('returns null when session or user id is missing', () => {
    expect(mapSupabaseSessionToAuthContext(null)).toBeNull();
    expect(
      mapSupabaseSessionToAuthContext({
        user: { id: '', email: 'a@b.com' },
      }),
    ).toBeNull();
  });

  it('maps user id and normalizes null email to undefined', () => {
    expect(
      mapSupabaseSessionToAuthContext({
        user: { id: 'user-1', email: null },
      }),
    ).toEqual({ user: { id: 'user-1' } });

    expect(
      mapSupabaseSessionToAuthContext({
        user: { id: 'user-2', email: 'user@example.com' },
      }),
    ).toEqual({ user: { id: 'user-2', email: 'user@example.com' } });
  });
});
