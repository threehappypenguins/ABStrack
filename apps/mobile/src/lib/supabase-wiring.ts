import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import * as SecureStore from 'expo-secure-store';
import { Base64 } from 'js-base64';
import { createSupabaseNativeClient } from '@abstrack/supabase/native';

/**
 * Chunking storage adapter for expo-secure-store.
 *
 * Supabase's persistSession: true stores the full session (access token, refresh token, user metadata)
 * as a single JSON blob under one key. This payload often exceeds the 2048-byte per-key limit enforced
 * by expo-secure-store, causing setItemAsync to fail and breaking persistence.
 *
 * UTF-8 Safe Approach:
 * This adapter encodes the session string to UTF-8 bytes, then to base64 (ASCII-safe).
 * The base64 string is chunked by character position (safe: base64 is ASCII-only, no multi-byte sequences).
 * Each chunk is stored with an indexed key (e.g., `key.chunk.0`, `key.chunk.1`) and a metadata key
 * tracking the chunk count. On read, chunks are reassembled, base64-decoded, and UTF-8-decoded.
 * This prevents splitting multi-byte UTF-8 sequences across chunk boundaries.
 *
 * Crash Recovery:
 * Metadata is written BEFORE chunks to serve as a commit marker. If the app crashes during setItem,
 * the next read will either find no metadata (safe: reads non-chunked key, which doesn't exist)
 * or find metadata but missing chunks (detects incomplete write, signals error to trigger re-auth).
 * SecureStore has no key enumeration, but this approach minimizes orphaned chunk keys.
 *
 * Stores auth session data using OS-backed encrypted storage via Keychain (iOS) / Keystore (Android).
 */
class ChunkingSecureStore {
  private static readonly CHUNK_SIZE = 2044; // Per-key byte limit is 2048; 2044 is conservative
  private static readonly CHUNK_SUFFIX = '.chunk';
  private static readonly META_SUFFIX = '.meta';
  private static readonly MAX_CHUNKS = 32;
  private static readonly META_FORMAT = 'v2';
  private static readonly PREFIX_A = 'a';
  private static readonly PREFIX_B = 'b';

  private static buildLegacyChunkKey(key: string, index: number): string {
    return `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${index}`;
  }

  private static buildPrefixedChunkKey(
    key: string,
    prefix: 'a' | 'b',
    index: number,
  ): string {
    return `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${prefix}.${index}`;
  }

  private static parseChunkMeta(rawMeta: string | null): {
    activePrefix: 'a' | 'b';
    chunkCount: number;
  } | null {
    if (!rawMeta) {
      return null;
    }

    try {
      const parsed: unknown = JSON.parse(rawMeta);
      if (
        typeof parsed === 'object' &&
        parsed !== null &&
        'format' in parsed &&
        'activePrefix' in parsed &&
        'chunkCount' in parsed
      ) {
        const format = (parsed as { format?: unknown }).format;
        const activePrefix = (parsed as { activePrefix?: unknown }).activePrefix;
        const chunkCount = (parsed as { chunkCount?: unknown }).chunkCount;
        if (
          format === ChunkingSecureStore.META_FORMAT &&
          (activePrefix === ChunkingSecureStore.PREFIX_A ||
            activePrefix === ChunkingSecureStore.PREFIX_B) &&
          typeof chunkCount === 'number' &&
          Number.isInteger(chunkCount) &&
          chunkCount > 0 &&
          chunkCount <= ChunkingSecureStore.MAX_CHUNKS
        ) {
          return {
            activePrefix,
            chunkCount,
          };
        }
      }
    } catch {
      // Legacy metadata is a plain number string; fall through.
    }

    return null;
  }

  private static toBase64(str: string): string {
    // Encode UTF-8 string to base64 using cross-platform js-base64 library
    // (avoids deprecated btoa/atob and escape/unescape which may not exist in all RN/Hermes runtimes)
    return Base64.encode(str);
  }

  private static fromBase64(str: string): string {
    // Decode base64 to UTF-8 string using cross-platform js-base64 library
    return Base64.decode(str);
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const meta = await SecureStore.getItemAsync(key + ChunkingSecureStore.META_SUFFIX);
      if (!meta) {
        // No metadata = key wasn't chunked (single-value storage)
        return SecureStore.getItemAsync(key);
      }

      const readUnchunkedFallback = async () => SecureStore.getItemAsync(key);

      const parsedMeta = ChunkingSecureStore.parseChunkMeta(meta);
      if (parsedMeta) {
        const chunks: string[] = [];
        for (let i = 0; i < parsedMeta.chunkCount; i++) {
          const chunkKey = ChunkingSecureStore.buildPrefixedChunkKey(
            key,
            parsedMeta.activePrefix,
            i,
          );
          const chunk = await SecureStore.getItemAsync(chunkKey);
          if (!chunk) {
            console.warn(
              `[ChunkingSecureStore] Missing chunk ${i}/${parsedMeta.chunkCount} for key: ${key} (incomplete write/crash recovery)`,
            );
            await this.removeChunks(key);
            return readUnchunkedFallback();
          }
          chunks.push(chunk);
        }

        const base64 = chunks.join('');
        return ChunkingSecureStore.fromBase64(base64);
      }

      const chunkCount = parseInt(meta, 10);
      if (isNaN(chunkCount) || chunkCount < 1) {
        console.warn(`[ChunkingSecureStore] Invalid chunk metadata for key: ${key}`);
        await this.removeChunks(key);
        return readUnchunkedFallback();
      }

      if (chunkCount > ChunkingSecureStore.MAX_CHUNKS) {
        console.warn(
          `[ChunkingSecureStore] Metadata chunk count exceeds supported max for key: ${key}`,
        );
        await this.removeChunks(key);
        return readUnchunkedFallback();
      }

      const firstChunkKey = ChunkingSecureStore.buildLegacyChunkKey(key, 0);
      const firstChunk = await SecureStore.getItemAsync(firstChunkKey);
      if (!firstChunk) {
        console.warn(
          `[ChunkingSecureStore] Missing first chunk for key: ${key} (falling back to unchunked value)`,
        );
        await this.removeChunks(key);
        return readUnchunkedFallback();
      }

      // Reassemble chunks in order
      // CRITICAL: Chunks are base64 strings (ASCII-safe), not raw bytes.
      // We join them first, then decode base64 to string only AFTER reassembly.
      // This prevents any multi-byte UTF-8 sequence corruption from straddling chunk boundaries.
      //
      // If metadata exists but chunks are missing, it indicates an incomplete write
      // (e.g., app crashed after metadata was written but before all chunks).
      // We try to clean up stale chunking metadata and fall back to the unchunked key.
      const chunks: string[] = [firstChunk];
      for (let i = 1; i < chunkCount; i++) {
        const chunkKey = ChunkingSecureStore.buildLegacyChunkKey(key, i);
        const chunk = await SecureStore.getItemAsync(chunkKey);
        if (!chunk) {
          console.warn(
            `[ChunkingSecureStore] Missing chunk ${i}/${chunkCount} for key: ${key} (incomplete write/crash recovery)`,
          );
          await this.removeChunks(key);
          return readUnchunkedFallback();
        }
        chunks.push(chunk);
      }

      // Join base64 chunks (all ASCII) and decode once → guarantees data integrity
      const base64 = chunks.join('');
      return ChunkingSecureStore.fromBase64(base64);
    } catch (error) {
      console.error(`[ChunkingSecureStore] Error reading key ${key}:`, error);
      await this.removeChunks(key);
      try {
        return await SecureStore.getItemAsync(key);
      } catch {
        return null;
      }
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    // ENCODING FLOW: String → UTF-8 bytes → base64 string (ASCII-safe, no multi-byte sequences)
    // This ensures chunk boundaries can be placed anywhere without splitting UTF-8 code points.
    const base64 = ChunkingSecureStore.toBase64(value);
    // Determine original UTF-8 byte length from base64 so direct storage is used whenever raw
    // value fits within SecureStore's per-key limit. This avoids unnecessary chunking/IO.
    const paddingLength = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
    const rawByteLength = (base64.length * 3) / 4 - paddingLength;

    if (rawByteLength <= ChunkingSecureStore.CHUNK_SIZE) {
      // Small value: store UTF-8 string directly (not base64-encoded), clean up any existing chunks
      await SecureStore.setItemAsync(key, value);
      await this.removeChunks(key);
      return;
    }

    // Large value: chunk the base64 string by character position (safe: base64 is pure ASCII)
    // Split base64 string into chunks that respect the byte limit
    // Since base64 is pure ASCII (single-byte characters), any split point is safe.
    const chunks: string[] = [];
    let pos = 0;
    while (pos < base64.length) {
      const chunk = base64.slice(pos, pos + ChunkingSecureStore.CHUNK_SIZE);
      chunks.push(chunk);
      pos += ChunkingSecureStore.CHUNK_SIZE;
    }

    // Enforce a hard upper bound so cleanup remains correct (SecureStore has no key enumeration).
    if (chunks.length > ChunkingSecureStore.MAX_CHUNKS) {
      throw new Error(
        `Auth session exceeds supported size: requires ${chunks.length} chunks (max ${ChunkingSecureStore.MAX_CHUNKS})`,
      );
    }

    const currentMetaRaw = await SecureStore.getItemAsync(
      key + ChunkingSecureStore.META_SUFFIX,
    );
    const currentMeta = ChunkingSecureStore.parseChunkMeta(currentMetaRaw);
    const nextPrefix: 'a' | 'b' =
      currentMeta?.activePrefix === ChunkingSecureStore.PREFIX_A
        ? ChunkingSecureStore.PREFIX_B
        : ChunkingSecureStore.PREFIX_A;
    const oldPrefix: 'a' | 'b' =
      nextPrefix === ChunkingSecureStore.PREFIX_A
        ? ChunkingSecureStore.PREFIX_B
        : ChunkingSecureStore.PREFIX_A;

    try {
      // Prepare target prefix by clearing any stale data for that inactive prefix.
      await this.deletePrefixedChunks(key, nextPrefix);

      // Store base64 chunks (not UTF-8 bytes) so no decoding happens at chunk boundaries.
      // Two-phase write:
      // 1) Write new chunks under an inactive prefix.
      // 2) Flip metadata to the new prefix only after all chunks are written.
      for (let i = 0; i < chunks.length; i++) {
        const chunkKey = ChunkingSecureStore.buildPrefixedChunkKey(key, nextPrefix, i);
        await SecureStore.setItemAsync(chunkKey, chunks[i]);
      }

      const metaKey = key + ChunkingSecureStore.META_SUFFIX;
      await SecureStore.setItemAsync(
        metaKey,
        JSON.stringify({
          format: ChunkingSecureStore.META_FORMAT,
          activePrefix: nextPrefix,
          chunkCount: chunks.length,
        }),
      );
    } catch (error) {
      console.error(`[ChunkingSecureStore] Error writing key ${key}:`, error);
      try {
        // Only clean the in-progress prefix. Preserve metadata and the last committed prefix.
        await this.deletePrefixedChunks(key, nextPrefix);
      } catch (cleanupError) {
        console.error(
          `[ChunkingSecureStore] Error rolling back failed write for key ${key}:`,
          cleanupError,
        );
      }
      throw error;
    }

    try {
      // Cleanup old direct value and inactive chunk data best-effort after commit.
      await SecureStore.deleteItemAsync(key);
      await this.deletePrefixedChunks(key, oldPrefix);
      await this.deleteLegacyChunks(key);
    } catch (cleanupError) {
      console.error(
        `[ChunkingSecureStore] Error cleaning up committed write for key ${key}:`,
        cleanupError,
      );
    }
  }

  async removeItem(key: string): Promise<void> {
    try {
      // Delete main key and any chunks
      await SecureStore.deleteItemAsync(key);
      await this.removeChunks(key);
    } catch (error) {
      console.error(`[ChunkingSecureStore] Error removing key ${key}:`, error);
      // Don't throw on remove failures; best-effort cleanup
    }
  }

  private async removeChunks(key: string): Promise<void> {
    try {
      await this.deleteLegacyChunks(key);
      await this.deletePrefixedChunks(key, ChunkingSecureStore.PREFIX_A);
      await this.deletePrefixedChunks(key, ChunkingSecureStore.PREFIX_B);
      await SecureStore.deleteItemAsync(key + ChunkingSecureStore.META_SUFFIX);
    } catch (error) {
      console.error(
        `[ChunkingSecureStore] Error cleaning up chunks for key ${key}:`,
        error,
      );
      // Best-effort cleanup; don't throw
    }
  }

  private async deleteLegacyChunks(key: string): Promise<void> {
    for (let i = 0; i < ChunkingSecureStore.MAX_CHUNKS; i++) {
      await SecureStore.deleteItemAsync(ChunkingSecureStore.buildLegacyChunkKey(key, i));
    }
  }

  private async deletePrefixedChunks(key: string, prefix: 'a' | 'b'): Promise<void> {
    for (let i = 0; i < ChunkingSecureStore.MAX_CHUNKS; i++) {
      await SecureStore.deleteItemAsync(
        ChunkingSecureStore.buildPrefixedChunkKey(key, prefix, i),
      );
    }
  }
}

const chunkingStore = new ChunkingSecureStore();

/**
 * Securely persists Supabase auth session using a chunking adapter.
 * Handles session payloads that exceed the 2048-byte expo-secure-store per-key limit.
 */
export const mobileAuthStorage = {
  getItem: (key: string) => chunkingStore.getItem(key),
  setItem: (key: string, value: string) => chunkingStore.setItem(key, value),
  removeItem: (key: string) => chunkingStore.removeItem(key),
};

export function createMobileSupabaseClient(): AbstrackSupabaseClient {
  return createSupabaseNativeClient(mobileAuthStorage);
}

let mobileSupabaseClient: AbstrackSupabaseClient | null = null;

export function getMobileSupabaseClient(): AbstrackSupabaseClient {
  if (!mobileSupabaseClient) {
    mobileSupabaseClient = createMobileSupabaseClient();
  }

  return mobileSupabaseClient;
}
