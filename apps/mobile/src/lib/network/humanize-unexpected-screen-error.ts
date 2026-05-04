/**
 * Maps transport-layer failures to copy suitable for async screen error panels.
 *
 * @param caught - Thrown value from a screen load path.
 * @param fallback - Copy when `caught` is not an `Error` or is unrecognized.
 * @returns User-facing string (no `TypeError:` noise).
 */
export function humanizeUnexpectedScreenError(
  caught: unknown,
  fallback: string,
): string {
  if (!(caught instanceof Error)) {
    return fallback;
  }
  const m = caught.message.toLowerCase();
  if (
    m.includes('network request failed') ||
    m.includes('failed to fetch') ||
    m.includes('networkerror when attempting') ||
    m.includes('the internet connection appears to be offline') ||
    m.includes('could not connect to the server')
  ) {
    return fallback;
  }
  return caught.message.trim().length > 0 ? caught.message : fallback;
}
