/**
 * Route prefixes where practitioner chrome (sidebar shell, etc.) is not shown.
 * Used by the practitioner app shell and public top navigation.
 */
export const PRACTITIONER_PUBLIC_PATH_PREFIXES = [
  '/login',
  '/invite',
  '/update-password',
  '/auth',
] as const;

/**
 * Whether `pathname` is a public practitioner route (exact match or nested under a prefix).
 *
 * @param pathname - Current path from the router (e.g. `usePathname()`), without query/hash.
 * @returns `true` when the app shell should not wrap the page.
 */
export function isPublicPractitionerPath(pathname: string): boolean {
  return PRACTITIONER_PUBLIC_PATH_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
