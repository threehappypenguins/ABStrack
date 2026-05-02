import * as SecureStore from 'expo-secure-store';
import { Base64 } from 'js-base64';

const SECURE_STORE_KEY = 'abstrack.powersync.sqlcipher_key_v1';

function randomBytes32(): Uint8Array {
  const bytes = new Uint8Array(32);
  const cryptoRef = globalThis.crypto;
  if (typeof cryptoRef?.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is unavailable; ensure react-native-get-random-values is imported at app entry (apps/mobile/index.js).',
    );
  }
  cryptoRef.getRandomValues(bytes);
  return bytes;
}

/**
 * Returns a stable SQLCipher key for the on-device PowerSync database.
 *
 * **Production posture:** The key is generated once per app install and stored in
 * {@link SecureStore}. It is **device-bound**, not derived from the Supabase user — swapping
 * accounts on the same install reuses the same file key; replicated PHI is cleared on logout via
 * `PowerSyncDatabase.disconnectAndClear`. For stricter threat models (per-user file
 * keys, hardware-backed keys), replace this helper — see `apps/mobile/src/lib/powersync/README.md`.
 *
 * @returns UTF-8 key string passed to OP-SQLite SQLCipher.
 */
export async function getOrCreateDeviceSqlcipherKey(): Promise<string> {
  const existing = await SecureStore.getItemAsync(SECURE_STORE_KEY);
  if (existing && existing.length > 0) {
    return existing;
  }
  const encoded = Base64.fromUint8Array(randomBytes32(), true);
  await SecureStore.setItemAsync(SECURE_STORE_KEY, encoded, {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  });
  return encoded;
}
