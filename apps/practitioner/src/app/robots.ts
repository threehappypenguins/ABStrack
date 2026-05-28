import type { MetadataRoute } from 'next';

/**
 * Practitioner web is not for public discovery; block all crawlers.
 *
 * @returns Robots directives for `/robots.txt`.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      disallow: '/',
    },
  };
}
