/**
 * Converts an ISO timestamp into an HTML `datetime-local` value using local time.
 *
 * @param iso - ISO timestamp to convert.
 * @returns Local datetime input string in `YYYY-MM-DDTHH:mm` format.
 */
export function toLocalDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

/**
 * Converts an HTML `datetime-local` input value to ISO.
 *
 * @param value - Local datetime input string.
 * @returns ISO timestamp when valid; otherwise `null`.
 */
export function localInputValueToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const date = new Date(trimmed);
  const time = date.getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  return date.toISOString();
}
