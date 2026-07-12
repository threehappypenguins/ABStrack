/** Canonical production origin for practitioner web. */
export const PRODUCTION_PRACTITIONER_WEB_ORIGIN =
  'https://practitioner.abstrack.org';

/**
 * Resolves the practitioner-web origin for `metadataBase` and Open Graph URLs.
 * Prefer `NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN` when set (e.g. local or staging).
 *
 * @returns Origin without trailing slash (e.g. `https://practitioner.abstrack.org`).
 */
export function getSiteUrl(): string {
  const fromEnv = process.env.NEXT_PUBLIC_PRACTITIONER_WEB_ORIGIN?.trim();
  if (fromEnv) {
    return fromEnv.replace(/\/$/, '');
  }
  if (process.env.NODE_ENV === 'production') {
    return PRODUCTION_PRACTITIONER_WEB_ORIGIN;
  }
  return 'http://localhost:3000';
}

/**
 * @returns `metadataBase` for Next.js root metadata.
 */
export function getMetadataBase(): URL {
  return new URL(`${getSiteUrl()}/`);
}
