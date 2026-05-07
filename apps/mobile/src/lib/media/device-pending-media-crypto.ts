import { Directory, File, Paths } from 'expo-file-system';

const FORMAT_V1 = 1;

/**
 * Derives a 256-bit AES-GCM key from the same device-bound material used for SQLCipher so queued
 * media ciphertext stays bound to this install without storing raw media as plain files.
 *
 * @param sqlcipherKeyMaterial - UTF-8 key string from {@link getOrCreateDeviceSqlcipherKey}.
 */
async function deriveAesKeyFromSqlcipherMaterial(
  sqlcipherKeyMaterial: string,
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest(
    'SHA-256',
    enc.encode(`abstrack.pending-episode-media.v1|${sqlcipherKeyMaterial}`),
  );
  return crypto.subtle.importKey(
    'raw',
    digest,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Writes plaintext media bytes to an app-document file as versioned AES-GCM ciphertext (IV inline).
 *
 * @param sqlcipherKeyMaterial - Device-bound key material (see {@link deriveAesKeyFromSqlcipherMaterial}).
 * @param documentRelativePath - Slash-separated path under {@link Paths.document} (e.g. `abstrack/pending-media/id.bin`).
 * @param plaintext - Raw capture bytes to protect at rest outside SQLCipher rows.
 */
export async function writeEncryptedMediaBytesToFile(
  sqlcipherKeyMaterial: string,
  documentRelativePath: string,
  plaintext: ArrayBuffer,
): Promise<void> {
  const key = await deriveAesKeyFromSqlcipherMaterial(sqlcipherKeyMaterial);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const cipher = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    plaintext,
  );
  const packed = new Uint8Array(1 + 12 + cipher.byteLength);
  packed[0] = FORMAT_V1;
  packed.set(iv, 1);
  packed.set(new Uint8Array(cipher), 13);
  const segments = documentRelativePath.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) {
    throw new Error('pending media path must not be empty.');
  }
  const fileName = segments[segments.length - 1];
  const parentSegments = segments.slice(0, -1);
  const parent =
    parentSegments.length > 0
      ? new Directory(Paths.document, ...parentSegments)
      : Paths.document;
  parent.create({ intermediates: true });
  const file = parent.createFile(fileName, null);
  file.write(packed);
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
  const key = await deriveAesKeyFromSqlcipherMaterial(sqlcipherKeyMaterial);
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
  const ciphertext = bytes.subarray(13);
  return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
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
