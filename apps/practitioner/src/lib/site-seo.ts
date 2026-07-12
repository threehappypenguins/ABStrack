import type { Metadata } from 'next';
import { getMetadataBase } from './site-url';

/** Default meta description for ABStrack practitioner web (invite-only; not indexed). */
export const PRACTITIONER_SITE_DESCRIPTION =
  'ABStrack Practitioner — invite-only clinician access for authorized patient episode review and care workflows.';

/** Social preview image in `apps/practitioner/public/og.png` (same asset as user web). */
const OG_IMAGE_PATH = '/og.png';

const OG_IMAGE_METADATA = {
  url: OG_IMAGE_PATH,
  width: 1731,
  height: 909,
  alt: 'ABStrack — health tracking for Auto-Brewery Syndrome',
} as const;

/**
 * Root layout metadata for practitioner web: title, icons, Open Graph, and noindex.
 *
 * @returns Next.js `Metadata` for `apps/practitioner/src/app/layout.tsx`.
 */
export function buildRootPractitionerMetadata(): Metadata {
  const metadataBase = getMetadataBase();
  return {
    metadataBase,
    title: {
      default: 'ABStrack Practitioner',
      template: '%s | ABStrack Practitioner',
    },
    description: PRACTITIONER_SITE_DESCRIPTION,
    applicationName: 'ABStrack Practitioner',
    icons: {
      icon: [
        { url: '/favicon.ico', sizes: 'any' },
        { url: '/favicon-16x16.png', sizes: '16x16', type: 'image/png' },
        { url: '/favicon-32x32.png', sizes: '32x32', type: 'image/png' },
      ],
      apple: [{ url: '/apple-touch-icon.png', sizes: '180x180' }],
    },
    robots: {
      index: false,
      follow: false,
      googleBot: { index: false, follow: false },
    },
    openGraph: {
      type: 'website',
      locale: 'en_US',
      siteName: 'ABStrack Practitioner',
      title: 'ABStrack Practitioner',
      description: PRACTITIONER_SITE_DESCRIPTION,
      url: '/',
      images: [OG_IMAGE_METADATA],
    },
    twitter: {
      card: 'summary_large_image',
      title: 'ABStrack Practitioner',
      description: PRACTITIONER_SITE_DESCRIPTION,
      images: [OG_IMAGE_PATH],
    },
  };
}
