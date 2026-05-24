import {
  buildUserWebCspDirectives,
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

  describe('normalizeCspHeaderValue', () => {
    /**
     * Guards the contract when policy text is built with a multi-line template literal
     * (one directive per line); the HTTP header value must still be a single line.
     */
    it('strips actual newlines and CRLF from raw policy text while preserving token spacing', () => {
      const rawMultilineTemplate = `default-src 'self';
script-src 'self' 'unsafe-inline';
connect-src 'self' https://abc.supabase.co wss://abc.supabase.co`;

      const fromLf = normalizeCspHeaderValue(rawMultilineTemplate);

      expect(fromLf).not.toMatch(/[\r\n]/);
      expect(fromLf).toBe(
        "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://abc.supabase.co wss://abc.supabase.co",
      );

      const rawCrLf = [
        "default-src 'self';",
        "script-src 'self' 'unsafe-inline';",
        "connect-src 'self' https://abc.supabase.co",
      ].join('\r\n');

      const fromCrLf = normalizeCspHeaderValue(rawCrLf);

      expect(fromCrLf).not.toMatch(/[\r\n]/);
      expect(fromCrLf).toBe(
        "default-src 'self'; script-src 'self' 'unsafe-inline'; connect-src 'self' https://abc.supabase.co",
      );
    });

    it('normalizes inline escape sequences and mixed padding', () => {
      expect(
        normalizeCspHeaderValue("default-src 'self';\nscript-src 'self'"),
      ).toBe("default-src 'self'; script-src 'self'");
      expect(normalizeCspHeaderValue('a\r\nb\rc')).toBe('a b c');
      expect(normalizeCspHeaderValue('x  \n  y')).toBe('x y');
    });
  });

  it('emits a single-line policy without accidental newlines', () => {
    const raw = buildUserWebCspDirectives({
      supabaseUrl: 'https://abc.supabase.co',
      isDev: false,
      isProduction: true,
    });
    const value = normalizeCspHeaderValue(raw);
    expect(value).not.toMatch(/\n/);
    expect(value).toContain('connect-src');
    expect(value).toContain('https://abc.supabase.co');
    expect(value).toContain('wss://abc.supabase.co');
    expect(value).toContain('img-src');
    expect(value).toContain('media-src');
    expect(value).toMatch(/img-src[^;]*https:\/\/abc\.supabase\.co/);
    expect(value).toMatch(/media-src[^;]*https:\/\/abc\.supabase\.co/);
    expect(value).toContain('upgrade-insecure-requests');
  });

  it("adds 'unsafe-eval' only in development", () => {
    const prod = normalizeCspHeaderValue(
      buildUserWebCspDirectives({
        supabaseUrl: 'https://abc.supabase.co',
        isDev: false,
        isProduction: true,
      }),
    );
    expect(prod).not.toContain("'unsafe-eval'");

    const dev = normalizeCspHeaderValue(
      buildUserWebCspDirectives({
        supabaseUrl: 'https://abc.supabase.co',
        isDev: true,
        isProduction: false,
      }),
    );
    expect(dev).toContain("'unsafe-eval'");
  });

  it('includes local dev connect-src origins only in development', () => {
    const prod = normalizeCspHeaderValue(
      buildUserWebCspDirectives({
        supabaseUrl: 'https://abc.supabase.co',
        isDev: false,
        isProduction: true,
      }),
    );
    expect(prod).not.toContain('http://localhost:3000');
    expect(prod).not.toContain('ws://localhost:54321');

    const dev = normalizeCspHeaderValue(
      buildUserWebCspDirectives({
        supabaseUrl: 'https://abc.supabase.co',
        isDev: true,
        isProduction: false,
      }),
    );
    expect(dev).toContain('http://localhost:3000');
    expect(dev).toContain('ws://localhost:54321');
    expect(dev).toContain('http://127.0.0.1:54321');
  });
});
