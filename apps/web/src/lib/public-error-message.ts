/**
 * Builds a user-facing string for Next.js route `error.tsx` boundaries.
 * In development, surfaces {@link Error.message} for debugging. In production, uses a generic
 * message and optionally appends the Next.js `digest` for correlation with server logs.
 * Always log the full `error` in the boundary (e.g. `console.error`) — never rely on this string
 * for diagnostics.
 *
 * @param error - Error from the error boundary (may include `digest` from the framework).
 * @returns Copy safe to pass to UI such as {@link PageError}.
 */
export function getPublicErrorBoundaryMessage(
  error: Error & { digest?: string },
): string {
  if (process.env.NODE_ENV === 'development') {
    return error.message || 'Unknown error';
  }
  if (error.digest) {
    return `Please try again. If this keeps happening, mention reference ${error.digest} when asking for help.`;
  }
  return 'Please try again.';
}
