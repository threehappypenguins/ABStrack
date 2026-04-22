/**
 * Shared local date/time helpers for food diary flows (string parts + picker wiring).
 * Keeps parsing and formatting consistent across standalone and in-episode screens.
 */

function pad2(value: number): string {
  return String(value).padStart(2, '0');
}

/**
 * @returns Local calendar date as `YYYY-MM-DD` for the current instant.
 */
export function currentLocalDate(): string {
  const now = new Date();
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
}

/**
 * @returns Local time as `HH:mm` for the current instant.
 */
export function currentLocalTime(): string {
  const now = new Date();
  return `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
}

/**
 * Combines local date and time strings into an ISO timestamp, or `null` if invalid.
 *
 * @param datePart - `YYYY-MM-DD`
 * @param timePart - `HH:mm`
 */
export function localDateTimeToIso(
  datePart: string,
  timePart: string,
): string | null {
  const date = datePart.trim();
  const time = timePart.trim();
  if (!date || !time) {
    return null;
  }
  const parsed = new Date(`${date}T${time}`);
  const value = parsed.getTime();
  if (!Number.isFinite(value)) {
    return null;
  }
  return parsed.toISOString();
}

/**
 * @param value - Picked date
 * @returns Local date string `YYYY-MM-DD`
 */
export function localDateFromDate(value: Date): string {
  return `${value.getFullYear()}-${pad2(value.getMonth() + 1)}-${pad2(value.getDate())}`;
}

/**
 * @param value - Picked date/time
 * @returns Local time string `HH:mm`
 */
export function localTimeFromDate(value: Date): string {
  return `${pad2(value.getHours())}:${pad2(value.getMinutes())}`;
}

/**
 * @param iso - ISO timestamp
 * @returns Local calendar date `YYYY-MM-DD` in the device timezone
 */
export function isoToLocalDate(iso: string): string {
  const date = new Date(iso);
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

/**
 * @param iso - ISO timestamp
 * @returns Local time `HH:mm` in the device timezone
 */
export function isoToLocalTime(iso: string): string {
  const date = new Date(iso);
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}
