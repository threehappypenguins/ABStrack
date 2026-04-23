/**
 * Converts an ISO timestamp into an HTML `datetime-local` value using local time.
 *
 * @param iso - ISO timestamp to convert.
 * @returns Local datetime input string in `YYYY-MM-DDTHH:mm` format, or empty string when invalid.
 */
export function toLocalDateTimeInputValue(iso: string): string {
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const offsetMs = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offsetMs).toISOString().slice(0, 16);
}

const LOCAL_DATETIME_INPUT_RE =
  /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/**
 * Converts an HTML `datetime-local` input value to ISO.
 * Parses `YYYY-MM-DDTHH:mm` (optional `:ss`) with explicit numeric fields and
 * {@link Date}’s local constructor so behavior matches local wall time across engines
 * (avoids `new Date(string)` ambiguity in Safari and others).
 *
 * @param value - Local datetime input string.
 * @returns ISO timestamp when valid; otherwise `null`.
 */
export function localInputValueToIso(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const match = LOCAL_DATETIME_INPUT_RE.exec(trimmed);
  if (!match) {
    return null;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = match[6] != null ? Number(match[6]) : 0;

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

  const time = local.getTime();
  if (!Number.isFinite(time)) {
    return null;
  }
  return local.toISOString();
}
