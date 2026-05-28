/** Canonical production origin for user web (marketing + app). */
export const PRODUCTION_USER_WEB_ORIGIN = 'https://abstrack.org';

/**
 * Resolves the public user-web origin for canonical URLs, Open Graph, and sitemap.
 * Prefer `NEXT_PUBLIC_USER_WEB_ORIGIN` (same name as mobile `EXPO_PUBLIC_USER_WEB_ORIGIN`).
 *
 * @returns Origin without trailing slash (e.g. `https://abstrack.org` or `http://localhost:3000`).
 */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_USER_WEB_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_USER_WEB_ORIGIN;
  }
  return 'http://localhost:3000';
}

/**
 * @returns `metadataBase` for Next.js root metadata.
 */
export function getMetadataBase(): URL {
  return new URL(`${getSiteUrl()}/`);
}
