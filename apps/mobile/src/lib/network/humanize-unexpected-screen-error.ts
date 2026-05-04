import { messageLooksLikeFetchTransportFailure } from './fetch-transport-failure-heuristic';

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
  if (messageLooksLikeFetchTransportFailure(caught.message)) {
    return fallback;
  }
  return caught.message.trim().length > 0 ? caught.message : fallback;
}
