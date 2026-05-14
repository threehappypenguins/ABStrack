import type { Metadata } from 'next';
import { LandingPageClient } from './LandingPageClient';

export const metadata: Metadata = {
  title: 'ABStrack — ABS health tracking',
  description:
    'Open-source, privacy-first health tracking for Auto-Brewery Syndrome (ABS): episode logging, markers, and authorized clinician review.',
};

/**
 * Public landing / marketing route at `/`. Authenticated users are redirected to the
 * dashboard from the client shell.
 *
 * @returns Landing page client tree.
 */
export default function IndexPage() {
  return <LandingPageClient />;
}
