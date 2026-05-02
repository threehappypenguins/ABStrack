import type { PowerSyncDatabase } from '@powersync/react-native';

import { createEncryptedAbstrackPowerSyncDatabase } from './encrypted-database';

let shared: PowerSyncDatabase | null = null;

/**
 * Lazily creates a single encrypted {@link PowerSyncDatabase} for the app process.
 *
 * The same instance is reused across sign-in sessions; call
 * `disconnectAndClear` on logout to wipe replicated rows while keeping the file.
 *
 * @param encryptionKey - SQLCipher key material (see {@link getOrCreateDeviceSqlcipherKey}).
 * @returns Shared database instance.
 */
export function getSharedPowerSyncDatabase(
  encryptionKey: string,
): PowerSyncDatabase {
  if (!shared) {
    shared = createEncryptedAbstrackPowerSyncDatabase({
      encryptionKey,
    });
  }
  return shared;
}

/**
 * For tests: reset the module singleton so Jest cases do not share mock state.
 *
 * @internal
 */
export function resetSharedPowerSyncDatabaseForTests(): void {
  shared = null;
}
