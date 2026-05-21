import { AppNotFoundPage } from '@abstrack/ui-web';

/**
 * Practitioner 404 boundary — uses app theme tokens instead of the Next.js default
 * HTTP fallback that overrides `body` from OS `prefers-color-scheme`. Top navigation comes from the
 * root layout ({@link PractitionerPublicTopNav} / {@link PractitionerAppShell}).
 */
export default function PractitionerNotFound() {
  return <AppNotFoundPage />;
}
