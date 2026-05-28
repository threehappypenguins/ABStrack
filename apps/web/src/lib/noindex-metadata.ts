import type { Metadata } from 'next';

/** Metadata for utility/auth routes that must not appear in search indexes. */
export const NOINDEX_ROUTE_METADATA: Metadata = {
  robots: {
    index: false,
    follow: false,
    googleBot: { index: false, follow: false },
  },
};
