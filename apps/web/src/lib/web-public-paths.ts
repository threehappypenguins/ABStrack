/**
 * Route prefixes where user-web authenticated chrome is not shown.
 * Used by {@link WebAppShell} and {@link WebPublicTopNav}.
 */
export const WEB_PUBLIC_PATH_PREFIXES = [
  '/login',
  '/signup',
  '/forgot-password',
  '/update-password',
  '/caretaker',
  '/auth',
] as const;

/**
 * Whether `pathname` is a public user-web route (landing or nested under a prefix).
 *
 * @param pathname - Current path from the router (e.g. `usePathname()`), without query/hash.
 * @returns `true` when authenticated shell chrome should not wrap the page.
 */
export function isPublicWebPath(pathname: string): boolean {
  if (pathname === '/') {
    return true;
  }
  return WEB_PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
