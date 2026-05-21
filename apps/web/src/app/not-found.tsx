import { AppNotFoundPage } from '@abstrack/ui-web';

/**
 * User web 404 boundary — uses app theme tokens instead of the Next.js default HTTP
 * fallback that overrides `body` from OS `prefers-color-scheme`. Top navigation comes from the
 * root layout ({@link WebPublicTopNav} / {@link WebAppShell}), matching practitioner.
 */
export default function WebNotFound() {
  return <AppNotFoundPage />;
}
