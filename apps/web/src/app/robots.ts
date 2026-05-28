import type { MetadataRoute } from 'next';
import { getSiteUrl } from '@/lib/site-url';

/**
 * Crawler rules for user web: index the marketing home; exclude app, auth, and API routes.
 *
 * @returns Robots directives for `/robots.txt`.
 */
export default function robots(): MetadataRoute.Robots {
  const siteUrl = getSiteUrl();
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/api/',
        '/auth/',
        '/dashboard',
        '/episode',
        '/episodes',
        '/insights',
        '/presets',
        '/settings',
        '/manage',
        '/food-diary',
        '/health-markers',
        '/login',
        '/signup',
        '/forgot-password',
        '/update-password',
        '/caretaker/',
      ],
    },
    sitemap: `${siteUrl}/sitemap.xml`,
  };
}
