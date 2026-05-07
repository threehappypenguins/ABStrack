import * as SecureStore from 'expo-secure-store';

const SECURE_STORE_KEY_PREFIX =
  'abstrack_powersync_first_sync_landed_v1_' as const;

/** Persisted when first sync has landed at least once for this user on this device. */
const LANDED_VALUE = '1' as const;

/**
 * Written when {@link clearPowerSyncFirstSyncLandedForUser} cannot delete the key (e.g. Keychain
 * quirks) so {@link getPowerSyncFirstSyncLandedForUser} never reads a stale `1` after the replica
 * was wiped — only {@link LANDED_VALUE} enables mirror trust for offline reads.
 */
const INVALIDATED_VALUE = '0' as const;

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
    return v === LANDED_VALUE;
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
    await SecureStore.setItemAsync(landingKeyForUser(userId), LANDED_VALUE, {
      keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
    });
  } catch {
    /* non-fatal: offline replica reads stay gated until next successful persist */
  }
}

/**
 * Removes the persisted first-sync marker for this user (e.g. after logout clears the local replica).
 * Idempotent if the key is already absent.
 *
 * **Sign-out:** Tries `deleteItemAsync` first. If delete fails (Keychain / Keystore), overwrites the
 * value with {@link INVALIDATED_VALUE} so {@link getPowerSyncFirstSyncLandedForUser} never returns
 * `true` from a stale {@link LANDED_VALUE} after `disconnectAndClear` has wiped SQLite — avoiding
 * offline reads that treat an empty replica as already synced.
 *
 * @param userId - `session.user.id` from the session that is signing out.
 * @throws When both delete and overwrite fail.
 */
export async function clearPowerSyncFirstSyncLandedForUser(
  userId: string,
): Promise<void> {
  const key = landingKeyForUser(userId);
  const storeOpts = {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  } as const;

  try {
    await SecureStore.deleteItemAsync(key);
    return;
  } catch (deleteError) {
    try {
      await SecureStore.setItemAsync(key, INVALIDATED_VALUE, storeOpts);
      return;
    } catch (overwriteError) {
      throw new Error(
        'PowerSync first-sync landing marker could not be cleared (delete and overwrite both failed).',
        {
          cause: { deleteError, overwriteError },
        },
      );
    }
  }
}
