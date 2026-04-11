'use client';

import { LiveAnnouncerProvider } from '@abstrack/ui/a11y-web';
import type { ReactNode } from 'react';

/**
 * Client boundary that mounts `LiveAnnouncerProvider` from `@abstrack/ui/a11y-web` for the practitioner web app.
 *
 * @param props - React children.
 * @returns Provider wrapping children.
 */
export function LiveAnnouncerRoot({ children }: { children: ReactNode }) {
  return <LiveAnnouncerProvider>{children}</LiveAnnouncerProvider>;
}
