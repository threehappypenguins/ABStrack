import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_KEY_PREFIX =
  'abstrack_powersync_first_sync_landed_v1_' as const;

function landingKeyForUser(userId: string): string {
  return `${SECURE_STORE_KEY_PREFIX}${userId}`;
}

/**
 * Whether this Supabase user has previously completed at least one PowerSync first sync on this
 * device (persisted). Used with the bridge’s in-memory `firstSyncCompleted` so cold starts offline
 * can still read replica data from an earlier online session.
 *
 * @param userId - `session.user.id`.
 * @returns `true` when a prior run persisted the landing flag.
 */
export async function getPowerSyncFirstSyncLandedForUser(
  userId: string,
): Promise<boolean> {
  try {
    const v = await SecureStore.getItemAsync(landingKeyForUser(userId));
    return v === '1';
  } catch {
    return false;
  }
}

/**
 * Persists that first sync has completed for this user on this device (idempotent).
 *
 * @param userId - `session.user.id`.
 */
export async function markPowerSyncFirstSyncLandedForUser(
  userId: string,
): Promise<void> {
  try {
    await SecureStore.setItemAsync(landingKeyForUser(userId), '1', {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    /* non-fatal: offline replica reads stay gated until next successful persist */
  }
}
