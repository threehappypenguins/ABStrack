import {
  buildPractitionerCspDirectives,
  normalizeCspHeaderValue,
  supabaseHttpAndWsOrigins,
} from '../csp-config.js';

describe('csp-config', () => {
  it('maps Supabase URL to HTTP and WebSocket origins', () => {
    expect(supabaseHttpAndWsOrigins('https://abc.supabase.co')).toEqual({
      httpOrigin: 'https://abc.supabase.co',
      wsOrigin: 'wss://abc.supabase.co',
    });
    expect(supabaseHttpAndWsOrigins('http://127.0.0.1:54321')).toEqual({
      httpOrigin: 'http://127.0.0.1:54321',
      wsOrigin: 'ws://127.0.0.1:54321',
    });
    expect(supabaseHttpAndWsOrigins(undefined)).toBeNull();
    expect(supabaseHttpAndWsOrigins('not-a-url')).toBeNull();
  });

  it('emits a single-line policy without accidental newlines', () => {
    const raw = buildPractitionerCspDirectives({
      supabaseUrl: 'https://abc.supabase.co',
      isDev: false,
      isProduction: true,
    });
    const value = normalizeCspHeaderValue(raw);
    expect(value).not.toMatch(/\n/);
    expect(value).toContain('connect-src');
    expect(value).toContain('https://abc.supabase.co');
    expect(value).toContain('wss://abc.supabase.co');
    expect(value).toContain('upgrade-insecure-requests');
  });

  it("adds 'unsafe-eval' only in development", () => {
    const prod = normalizeCspHeaderValue(
      buildPractitionerCspDirectives({
        supabaseUrl: 'https://abc.supabase.co',
        isDev: false,
        isProduction: true,
      }),
    );
    expect(prod).not.toContain("'unsafe-eval'");

    const dev = normalizeCspHeaderValue(
      buildPractitionerCspDirectives({
        supabaseUrl: 'https://abc.supabase.co',
        isDev: true,
        isProduction: false,
      }),
    );
    expect(dev).toContain("'unsafe-eval'");
  });
});
