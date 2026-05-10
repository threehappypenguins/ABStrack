/**
 * Normalizes an email address for case-insensitive comparison (e.g. caretaker invite email).
 *
 * @param raw - Raw user input.
 * @returns Trimmed lowercase string (may be empty if input is only whitespace).
 */
export function normalizeEmailForLookup(raw: string): string {
  return raw.trim().toLowerCase();
}
