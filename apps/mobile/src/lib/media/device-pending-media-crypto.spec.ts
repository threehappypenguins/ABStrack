import {
  deleteEncryptedPendingMediaFileBestEffort,
  readEncryptedMediaFileToArrayBuffer,
  writeEncryptedMediaBytesToFile,
} from './device-pending-media-crypto';

const KEY = 'jest-sqlcipher-material-32chars!!';

describe('device-pending-media-crypto', () => {
  it('writeEncryptedMediaBytesToFile + readEncryptedMediaFileToArrayBuffer round-trip', async () => {
    const rel = 'abstrack/pending-media/roundtrip-test.bin';
    const plaintext = new Uint8Array([1, 2, 3, 4, 255, 0, 9]).buffer;
    await writeEncryptedMediaBytesToFile(KEY, rel, plaintext);
    const back = await readEncryptedMediaFileToArrayBuffer(KEY, rel);
    expect(new Uint8Array(back)).toEqual(new Uint8Array(plaintext));
  });

  it('rejects decryption with wrong key material', async () => {
    const rel = 'abstrack/pending-media/wrong-key-test.bin';
    const plaintext = new TextEncoder().encode('secret payload').buffer;
    await writeEncryptedMediaBytesToFile(KEY, rel, plaintext);
    await expect(
      readEncryptedMediaFileToArrayBuffer(
        'different-material-32chars!!!!',
        rel,
      ),
    ).rejects.toThrow();
  });

  it('deleteEncryptedPendingMediaFileBestEffort removes ciphertext so a later read fails', async () => {
    const rel = 'abstrack/pending-media/delete-test.bin';
    await writeEncryptedMediaBytesToFile(KEY, rel, new Uint8Array([7]).buffer);
    await expect(
      readEncryptedMediaFileToArrayBuffer(KEY, rel),
    ).resolves.toBeDefined();
    deleteEncryptedPendingMediaFileBestEffort(rel);
    await expect(readEncryptedMediaFileToArrayBuffer(KEY, rel)).rejects.toThrow(
      /Mock expo-file-system File.bytes: missing/,
    );
  });

  it('deleteEncryptedPendingMediaFileBestEffort no-ops on empty path', () => {
    expect(() => deleteEncryptedPendingMediaFileBestEffort('  ')).not.toThrow();
  });
});
