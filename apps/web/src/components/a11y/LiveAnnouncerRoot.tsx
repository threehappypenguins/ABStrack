'use client';

import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import type { ReactNode } from 'react';

/**
 * Client boundary that mounts `LiveAnnouncerProvider` from `@abstrack/ui/a11y-web` for the user web app
 * so `useAnnounce()` is available under the root layout.
 *
 * @param props - React children.
 * @returns Provider wrapping children.
 */
export function LiveAnnouncerRoot({ children }: { children: ReactNode }) {
  return <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>;
}
