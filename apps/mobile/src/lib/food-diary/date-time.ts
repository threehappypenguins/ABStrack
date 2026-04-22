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

const LOCAL_DATE_PART_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const LOCAL_TIME_PART_RE = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Combines local date and time strings into an ISO timestamp, or `null` if invalid.
 * Parses components and uses the local `Date` constructor (not `new Date(string)`) so
 * wall time is consistent across Hermes/JSC.
 *
 * @param datePart - `YYYY-MM-DD`
 * @param timePart - `HH:mm` (optional `:ss`)
 */
export function localDateTimeToIso(
  datePart: string,
  timePart: string,
): string | null {
  const dTrim = datePart.trim();
  const tTrim = timePart.trim();
  if (!dTrim || !tTrim) {
    return null;
  }
  const dateMatch = LOCAL_DATE_PART_RE.exec(dTrim);
  const timeMatch = LOCAL_TIME_PART_RE.exec(tTrim);
  if (!dateMatch || !timeMatch) {
    return null;
  }
  const year = Number(dateMatch[1]);
  const month = Number(dateMatch[2]);
  const day = Number(dateMatch[3]);
  const hour = Number(timeMatch[1]);
  const minute = Number(timeMatch[2]);
  const second = timeMatch[3] != null ? Number(timeMatch[3]) : 0;

  if (
    !Number.isFinite(year) ||
    !Number.isFinite(month) ||
    !Number.isFinite(day) ||
    !Number.isFinite(hour) ||
    !Number.isFinite(minute) ||
    !Number.isFinite(second) ||
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  const local = new Date(year, month - 1, day, hour, minute, second, 0);
  if (
    local.getFullYear() !== year ||
    local.getMonth() !== month - 1 ||
    local.getDate() !== day ||
    local.getHours() !== hour ||
    local.getMinutes() !== minute ||
    local.getSeconds() !== second
  ) {
    return null;
  }

  const value = local.getTime();
  if (!Number.isFinite(value)) {
    return null;
  }
  return local.toISOString();
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
