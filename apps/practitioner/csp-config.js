/**
 * Builds a single-line Content-Security-Policy value for the practitioner Next.js app.
 * Used from `next.config.js` (Node at build time). See `docs/SECURITY_BASELINE.md`.
 */

/**
 * Normalizes a CSP header string for a single-line HTTP header value: CRLF/LF/CR become spaces,
 * then runs of whitespace collapse to one space, then trim (Next.js CSP examples use this shape).
 *
 * @param {string} raw - Multi-line or padded policy text.
 * @returns {string} Header-safe single-line value (no `\r` or `\n`).
 */
function normalizeCspHeaderValue(raw) {
  return raw
    .replace(/\r\n|\r|\n/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Adds common local dev origins so Report-Only does not spam the console for Next HMR and
 * typical Supabase CLI URLs. Does not apply to production builds.
 *
 * @param {Set<string>} connectParts - Mutable set of `connect-src` tokens.
 * @param {boolean} isDev - Whether `NODE_ENV === 'development'`.
 */
function addDevLocalConnectSources(connectParts, isDev) {
  if (!isDev) {
    return;
  }
  const devPorts = ['3000', '3001', '4200'];
  const hosts = ['localhost', '127.0.0.1'];
  for (const host of hosts) {
    connectParts.add(`http://${host}:54321`);
    connectParts.add(`ws://${host}:54321`);
    for (const port of devPorts) {
      connectParts.add(`http://${host}:${port}`);
      connectParts.add(`ws://${host}:${port}`);
    }
  }
}

/**
 * Returns HTTP and WebSocket origins for the configured Supabase project URL (Auth, REST,
 * Realtime, Storage share the same project host).
 *
 * @param {string | undefined} supabaseUrl - `NEXT_PUBLIC_SUPABASE_URL` (or equivalent).
 * @returns {{ httpOrigin: string, wsOrigin: string } | null}
 */
function supabaseHttpAndWsOrigins(supabaseUrl) {
  if (!supabaseUrl) {
    return null;
  }
  try {
    const u = new URL(supabaseUrl);
    const httpOrigin = u.origin;
    const wsProtocol = u.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsOrigin = `${wsProtocol}//${u.host}`;
    return { httpOrigin, wsOrigin };
  } catch {
    return null;
  }
}

/**
 * Builds the practitioner CSP directive string (before newline normalization).
 *
 * @param {object} opts - Options.
 * @param {string | undefined} opts.supabaseUrl - `NEXT_PUBLIC_SUPABASE_URL` from the build environment.
 * @param {boolean} opts.isDev - True when `NODE_ENV === 'development'`.
 * @param {boolean} opts.isProduction - True when `NODE_ENV === 'production'`.
 * @returns {string} Semicolon-separated CSP directives.
 */
function buildPractitionerCspDirectives(opts) {
  const { supabaseUrl, isDev, isProduction } = opts;

  const connectParts = new Set(["'self'"]);
  const origins = supabaseHttpAndWsOrigins(supabaseUrl);
  if (origins) {
    connectParts.add(origins.httpOrigin);
    connectParts.add(origins.wsOrigin);
  }
  addDevLocalConnectSources(connectParts, isDev);

  const connectSrc = Array.from(connectParts).join(' ');

  const scriptParts = ["'self'", "'unsafe-inline'"];
  if (isDev) {
    scriptParts.push("'unsafe-eval'");
  }

  /** @type {string[]} */
  const directives = [
    "default-src 'self'",
    `script-src ${scriptParts.join(' ')}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    `connect-src ${connectSrc}`,
    "worker-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "frame-src 'none'",
  ];

  if (
    isProduction &&
    supabaseUrl &&
    supabaseUrl.trim().toLowerCase().startsWith('https://')
  ) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

module.exports = {
  buildPractitionerCspDirectives,
  normalizeCspHeaderValue,
  supabaseHttpAndWsOrigins,
};
