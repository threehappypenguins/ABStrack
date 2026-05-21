import { AppNotFoundPanel } from '@abstrack/ui-web';

/**
 * User web 404 boundary — uses app theme tokens instead of the Next.js default HTTP
 * fallback that overrides `body` from OS `prefers-color-scheme`.
 */
export default function WebNotFound() {
  return <AppNotFoundPanel className="min-h-[min(100%,calc(100svh-4.5rem))]" />;
}
