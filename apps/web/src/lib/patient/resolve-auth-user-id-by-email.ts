/**
 * Normalizes an email address for case-insensitive comparison.
 *
 * @param raw - Raw user input.
 * @returns Trimmed lowercase email.
 */
export function normalizeEmailForLookup(raw: string): string {
  return raw.trim().toLowerCase();
}
