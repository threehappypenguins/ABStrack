import type { Metadata } from 'next';
import { getMetadataBase, getSiteUrl } from './site-url';

/** Default meta description for ABStrack user web (landing and fallbacks). */
export const SITE_DESCRIPTION =
  'Open-source, privacy-first health tracking for Auto-Brewery Syndrome (ABS): episode logging, markers, and authorized clinician review.';

/** Search-oriented phrases; used in `keywords` and on-page copy alignment. */
export const SITE_KEYWORDS = [
  'Auto-Brewery Syndrome',
  'ABS',
  'auto brewery syndrome',
  'health tracking',
  'episode logging',
  'BAC tracking',
  'privacy-first health app',
  'open source health app',
] as const;

/** Social preview image in `apps/web/public/og.png`. */
const OG_IMAGE_PATH = '/og.png';

const OG_IMAGE_METADATA = {
  url: OG_IMAGE_PATH,
  width: 1731,
  height: 909,
  alt: 'ABStrack — health tracking for Auto-Brewery Syndrome',
} as const;

/**
 * Root layout metadata: title template, description, Open Graph, Twitter.
 *
 * @returns Next.js `Metadata` for `apps/web/src/app/layout.tsx`.
 */
export function buildRootSiteMetadata(): Metadata {
  const metadataBase = getMetadataBase();
  return {
    metadataBase,
    title: {
      default: 'ABStrack — Health tracking for Auto-Brewery Syndrome',
      template: '%s | ABStrack',
    },
    description: SITE_DESCRIPTION,
    keywords: [...SITE_KEYWORDS],
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: 'ABStrack',
      title: 'ABStrack — Health tracking for Auto-Brewery Syndrome',
      description: SITE_DESCRIPTION,
      url: '/',
      images: [OG_IMAGE_METADATA],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'ABStrack — Health tracking for Auto-Brewery Syndrome',
      description: SITE_DESCRIPTION,
      images: [OG_IMAGE_PATH],
    },
  };
}

/** Landing route (`/`) metadata — absolute title avoids the root title template suffix. */
export const LANDING_PAGE_METADATA: Metadata = {
  title: { absolute: 'ABStrack — ABS health tracking' },
  description: SITE_DESCRIPTION,
  keywords: [...SITE_KEYWORDS],
  alternates: {
    canonical: '/',
  },
  openGraph: {
    title: 'ABStrack — ABS health tracking',
    description: SITE_DESCRIPTION,
    url: '/',
    images: [OG_IMAGE_METADATA],
  },
  twitter: {
    card: 'summary_large_image',
    images: [OG_IMAGE_PATH],
  },
};

/**
 * JSON-LD for the public landing page (`WebSite` + `SoftwareApplication`).
 *
 * @returns Serializable object for a `application/ld+json` script tag.
 */
export function buildLandingJsonLd(): Record<string, unknown> {
  const siteUrl = getSiteUrl();
  return {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebSite',
        name: 'ABStrack',
        url: siteUrl,
        description: SITE_DESCRIPTION,
        inLanguage: 'en',
      },
      {
        '@type': 'SoftwareApplication',
        name: 'ABStrack',
        applicationCategory: 'HealthApplication',
        operatingSystem: 'Web, iOS, Android',
        description: SITE_DESCRIPTION,
        url: siteUrl,
        offers: {
          '@type': 'Offer',
          price: '0',
          priceCurrency: 'USD',
        },
        isAccessibleForFree: true,
        keywords: SITE_KEYWORDS.join(', '),
      },
    ],
  };
}
