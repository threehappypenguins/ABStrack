import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NOINDEX_ROUTE_METADATA } from '@/lib/noindex-metadata';

export const metadata: Metadata = NOINDEX_ROUTE_METADATA;

/** Layout for `/signup` (no search indexing). */
export default function SignupLayout({ children }: { children: ReactNode }) {
  return children;
}
