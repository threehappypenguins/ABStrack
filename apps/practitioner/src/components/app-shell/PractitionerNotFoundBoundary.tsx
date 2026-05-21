'use client';

import { AppNotFoundPage } from '@abstrack/ui-web';

/**
 * Practitioner root `not-found` content: never wraps in `<main>` — public pages supply their own
 * landmark, and {@link PractitionerAppShell} provides `<main id="main-content">` on private routes.
 *
 * @returns Themed 404 panel without an extra main wrapper.
 */
export function PractitionerNotFoundBoundary() {
  return <AppNotFoundPage wrapInMain={false} />;
}
