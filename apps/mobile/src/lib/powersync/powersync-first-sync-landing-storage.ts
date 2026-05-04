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

/**
 * Removes the persisted first-sync marker for this user (e.g. after logout clears the local replica).
 * Idempotent if the key is already absent (Expo SecureStore treats missing keys as a no-op).
 *
 * **Sign-out:** Callers must handle rejection — if the replica is cleared but this delete fails, a
 * later login could otherwise re-hydrate `firstSyncLandedOnDevice` from stale SecureStore while the
 * replica is empty, and offline reads would trust that mirror incorrectly.
 *
 * @param userId - `session.user.id` from the session that is signing out.
 * @throws When `SecureStore.deleteItemAsync` fails (keychain / keystore errors, etc.).
 */
export async function clearPowerSyncFirstSyncLandedForUser(
  userId: string,
): Promise<void> {
  await SecureStore.deleteItemAsync(landingKeyForUser(userId));
}
