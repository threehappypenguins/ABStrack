import { gcm } from '@noble/ciphers/aes.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { File, Paths } from 'expo-file-system';

const FORMAT_V1 = 1;

/**
 * Derives a 256-bit AES-GCM key from the same device-bound material used for SQLCipher so queued
 * media ciphertext stays bound to this install without storing raw media as plain files.
 *
 * Uses SHA-256 in pure JS (no `crypto.subtle`) so React Native builds where `subtle` is missing
 * still encrypt/decrypt; layout matches Web Crypto AES-GCM (ciphertext || 16-byte tag).
 *
 * @param sqlcipherKeyMaterial - UTF-8 key string from {@link getOrCreateDeviceSqlcipherKey}.
 */
function deriveAesKeyBytesFromSqlcipherMaterial(
  sqlcipherKeyMaterial: string,
): Uint8Array {
  const enc = new TextEncoder();
  return sha256(
    enc.encode(`abstrack.pending-episode-media.v1|${sqlcipherKeyMaterial}`),
  );
}

function getRandomValuesForIv(iv: Uint8Array): void {
  const c = globalThis.crypto as Crypto | undefined;
  if (typeof c?.getRandomValues !== 'function') {
    throw new Error(
      'crypto.getRandomValues is unavailable; cannot generate AES-GCM nonce for pending media.',
    );
  }
  c.getRandomValues(iv);
}

/**
 * Writes plaintext media bytes to an app-document file as versioned AES-GCM ciphertext (IV inline).
 *
 * @param sqlcipherKeyMaterial - Device-bound key material (see {@link deriveAesKeyBytesFromSqlcipherMaterial}).
 * @param documentRelativePath - Slash-separated path under {@link Paths.document} (e.g. `abstrack/pending-media/id.bin`).
 * @param plaintext - Raw capture bytes to protect at rest outside SQLCipher rows.
 */
export async function writeEncryptedMediaBytesToFile(
  sqlcipherKeyMaterial: string,
  documentRelativePath: string,
  plaintext: ArrayBuffer,
): Promise<void> {
  const keyBytes = deriveAesKeyBytesFromSqlcipherMaterial(sqlcipherKeyMaterial);
  const iv = new Uint8Array(12);
  getRandomValuesForIv(iv);
  const pt = new Uint8Array(plaintext);
  const cipher = gcm(keyBytes, iv);
  const packedCipher = cipher.encrypt(pt);
  const packed = new Uint8Array(1 + 12 + packedCipher.length);
  packed[0] = FORMAT_V1;
  packed.set(iv, 1);
  packed.set(packedCipher, 13);
  const segments = documentRelativePath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error('pending media path must not be empty.');
  }
  /**
   * Use {@link File.create} under {@link Paths.document} so writes hit one coherent filesystem path.
   * `Directory.createFile` can behave inconsistently across hosts when chained after directory helpers.
   */
  const file = new File(Paths.document, ...segments);
  file.create({ intermediates: true, overwrite: true });
  file.write(packed);
  if (!file.exists || file.size !== packed.length) {
    throw new Error(
      `Encrypted pending media did not persist (${documentRelativePath}): exists=${String(file.exists)} size=${String(file.size)} expected=${packed.length}.`,
    );
  }
}

/**
 * Reads a ciphertext file produced by {@link writeEncryptedMediaBytesToFile} back into plaintext bytes.
 *
 * @param sqlcipherKeyMaterial - Same material used for encryption.
 * @param documentRelativePath - Path under documents (same string stored in the pending queue row).
 */
export async function readEncryptedMediaFileToArrayBuffer(
  sqlcipherKeyMaterial: string,
  documentRelativePath: string,
): Promise<ArrayBuffer> {
  const keyBytes = deriveAesKeyBytesFromSqlcipherMaterial(sqlcipherKeyMaterial);
  const segments = documentRelativePath.split('/').filter((s) => s.length > 0);
  const file = new File(Paths.document, ...segments);
  const bytes = await file.bytes();
  if (bytes.byteLength < 1 + 12 + 16) {
    throw new Error('Invalid encrypted media file.');
  }
  if (bytes[0] !== FORMAT_V1) {
    throw new Error('Unsupported encrypted media format.');
  }
  const iv = bytes.subarray(1, 13);
  const ciphertextWithTag = bytes.subarray(13);
  const cipher = gcm(keyBytes, iv);
  const decrypted = cipher.decrypt(ciphertextWithTag);
  const out = new ArrayBuffer(decrypted.byteLength);
  new Uint8Array(out).set(decrypted);
  return out;
}

/**
 * Deletes a ciphertext file if it exists (queue cleanup); ignores missing paths.
 *
 * @param documentRelativePath - Path under documents, or empty to no-op.
 */
export function deleteEncryptedPendingMediaFileBestEffort(
  documentRelativePath: string | null | undefined,
): void {
  const trimmed = documentRelativePath?.trim() ?? '';
  if (!trimmed) {
    return;
  }
  try {
    const segments = trimmed.split('/').filter((s) => s.length > 0);
    const file = new File(Paths.document, ...segments);
    if (file.exists) {
      file.delete();
    }
  } catch {
    /* best-effort */
  }
}
