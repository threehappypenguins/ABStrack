import { mapSupabaseUserToAuthContext } from './auth-provider-session';

describe('mapSupabaseUserToAuthContext', () => {
  it('returns null when user or user id is missing', () => {
    expect(mapSupabaseUserToAuthContext(null)).toBeNull();
    expect(mapSupabaseUserToAuthContext(undefined)).toBeNull();
    expect(
      mapSupabaseUserToAuthContext({ id: '', email: 'a@b.com' }),
    ).toBeNull();
  });

  it('maps user id and normalizes null email to undefined', () => {
    expect(mapSupabaseUserToAuthContext({ id: 'user-1', email: null })).toEqual(
      { user: { id: 'user-1' } },
    );

    expect(
      mapSupabaseUserToAuthContext({
        id: 'user-2',
        email: 'user@example.com',
      }),
    ).toEqual({ user: { id: 'user-2', email: 'user@example.com' } });
  });
});
