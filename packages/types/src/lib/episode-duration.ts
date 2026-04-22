/**
 * Formats an episode span in a simple spoken-friendly form.
 *
 * @param startedAt - Episode start timestamp (`episodes.started_at`).
 * @param endedAt - Episode end timestamp (`episodes.ended_at`).
 * @returns Duration text such as `1 hour 12 minutes`, or `null` for invalid data.
 */
export function formatEpisodeDurationSimple(
  startedAt: string,
  endedAt: string | null | undefined,
): string | null {
  if (!endedAt) {
    return null;
  }
  const startMs = Date.parse(startedAt);
  const endMs = Date.parse(endedAt);
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) {
    return null;
  }
  const diffMs = endMs - startMs;
  if (diffMs < 0) {
    return null;
  }
  const totalMinutes = Math.floor(diffMs / 60000);
  if (totalMinutes <= 0) {
    return 'Less than 1 minute';
  }
  const days = Math.floor(totalMinutes / (24 * 60));
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
  const minutes = totalMinutes % 60;
  const parts: string[] = [];
  if (days > 0) {
    parts.push(days === 1 ? '1 day' : `${days} days`);
  }
  if (hours > 0) {
    parts.push(hours === 1 ? '1 hour' : `${hours} hours`);
  }
  if (minutes > 0) {
    parts.push(minutes === 1 ? '1 minute' : `${minutes} minutes`);
  }
  return parts.join(' ');
}
