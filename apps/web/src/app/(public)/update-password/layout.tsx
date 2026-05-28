import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { NOINDEX_ROUTE_METADATA } from '@/lib/noindex-metadata';

export const metadata: Metadata = NOINDEX_ROUTE_METADATA;

/** Layout for `/update-password` (no search indexing). */
export default function UpdatePasswordLayout({
  children,
}: {
  children: ReactNode;
}) {
  return children;
}
