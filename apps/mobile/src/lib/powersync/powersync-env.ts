/**
 * Reads the PowerSync Service endpoint embedded at bundle time (Expo `EXPO_PUBLIC_*`).
 *
 * @returns Trimmed URL string, or empty string when unset (offline replication disabled).
 */
export function getMobilePowerSyncUrl(): string {
  const raw = process.env.EXPO_PUBLIC_POWERSYNC_URL;
  return typeof raw === 'string' ? raw.trim() : '';
}
