import { AppNotFoundPanel } from '@abstrack/ui-web';

/**
 * Practitioner 404 boundary — uses app theme tokens instead of the Next.js default
 * HTTP fallback that overrides `body` from OS `prefers-color-scheme`.
 */
export default function PractitionerNotFound() {
  return <AppNotFoundPanel className="min-h-[min(100%,calc(100svh-4.5rem))]" />;
}
