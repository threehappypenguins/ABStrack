import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import * as SecureStore from 'expo-secure-store';
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
 * Satisfies HIPAA/PHIA requirements by storing all data encrypted via OS Keychain (iOS) / Keystore (Android).
 */
class ChunkingSecureStore {
  private static readonly CHUNK_SIZE = 2044; // Per-key byte limit is 2048; 2044 is conservative
  private static readonly CHUNK_SUFFIX = '.chunk';
  private static readonly META_SUFFIX = '.meta';

  private static toBase64(str: string): string {
    return btoa(unescape(encodeURIComponent(str)));
  }

  private static fromBase64(str: string): string {
    return decodeURIComponent(escape(atob(str)));
  }

  async getItem(key: string): Promise<string | null> {
    try {
      const meta = await SecureStore.getItemAsync(key + ChunkingSecureStore.META_SUFFIX);
      if (!meta) {
        // No metadata = key wasn't chunked (single-value storage)
        return SecureStore.getItemAsync(key);
      }

      const chunkCount = parseInt(meta, 10);
      if (isNaN(chunkCount) || chunkCount < 1) {
        console.warn(`[ChunkingSecureStore] Invalid chunk metadata for key: ${key}`);
        return null;
      }

      // Reassemble chunks in order
      // CRITICAL: Chunks are base64 strings (ASCII-safe), not raw bytes.
      // We join them first, then decode base64 to string only AFTER reassembly.
      // This prevents any multi-byte UTF-8 sequence corruption from straddling chunk boundaries.
      //
      // If metadata exists but chunks are missing, it indicates an incomplete write
      // (e.g., app crashed after metadata was written but before all chunks).
      // We return null to signal the session is broken; caller should trigger re-auth.
      const chunks: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${i}`;
        const chunk = await SecureStore.getItemAsync(chunkKey);
        if (!chunk) {
          console.warn(
            `[ChunkingSecureStore] Missing chunk ${i}/${chunkCount} for key: ${key} (incomplete write/crash recovery)`,
          );
          return null;
        }
        chunks.push(chunk);
      }

      // Join base64 chunks (all ASCII) and decode once → guarantees data integrity
      const base64 = chunks.join('');
      return ChunkingSecureStore.fromBase64(base64);
    } catch (error) {
      console.error(`[ChunkingSecureStore] Error reading key ${key}:`, error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      // ENCODING FLOW: String → UTF-8 bytes → base64 string (ASCII-safe, no multi-byte sequences)
      // This ensures chunk boundaries can be placed anywhere without splitting UTF-8 code points.
      const base64 = ChunkingSecureStore.toBase64(value);
      const base64Length = new TextEncoder().encode(base64).byteLength;

      if (base64Length <= ChunkingSecureStore.CHUNK_SIZE) {
        // Small value: store UTF-8 string directly (not base64-encoded), clean up any existing chunks
        await this.removeChunks(key);
        await SecureStore.setItemAsync(key, value);
        return;
      }

      // Large value: chunk the base64 string by character position (safe: base64 is pure ASCII)
      // First, clean up the main key and any existing chunks to avoid orphaned data
      await SecureStore.deleteItemAsync(key);
      await this.removeChunks(key);

      // Split base64 string into chunks that respect the byte limit
      // Since base64 is pure ASCII (single-byte characters), any split point is safe.
      const chunks: string[] = [];
      let pos = 0;
      while (pos < base64.length) {
        // Find the right slice length by checking byte length
        let sliceLength = Math.ceil((ChunkingSecureStore.CHUNK_SIZE * base64.length) / base64Length);
        let chunk = base64.slice(pos, pos + sliceLength);

        // Adjust slice length if this chunk exceeds the byte limit
        // (base64 can vary in byte size due to padding characters)
        while (new TextEncoder().encode(chunk).byteLength > ChunkingSecureStore.CHUNK_SIZE && sliceLength > 1) {
          sliceLength--;
          chunk = base64.slice(pos, pos + sliceLength);
        }

        chunks.push(chunk);
        pos += sliceLength;
      }

      // Store base64 chunks (not UTF-8 bytes) so no decoding happens at chunk boundaries
      // IMPORTANT: Write metadata FIRST as a marker that chunking is in progress.
      // If the app crashes after this point, the next read will detect incomplete chunks
      // and error cleanly (triggering re-auth). Without metadata, orphaned chunks are undiscoverable.
      const metaKey = key + ChunkingSecureStore.META_SUFFIX;
      await SecureStore.setItemAsync(metaKey, chunks.length.toString());

      // Then write chunks; if crash occurs here, next read will see metadata but missing chunks
      for (let i = 0; i < chunks.length; i++) {
        const chunkKey = `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${i}`;
        await SecureStore.setItemAsync(chunkKey, chunks[i]);
      }
    } catch (error) {
      console.error(`[ChunkingSecureStore] Error writing key ${key}:`, error);
      throw error;
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
      const metaKey = key + ChunkingSecureStore.META_SUFFIX;
      const meta = await SecureStore.getItemAsync(metaKey);

      if (meta) {
        const chunkCount = parseInt(meta, 10);
        if (!isNaN(chunkCount) && chunkCount > 0) {
          for (let i = 0; i < chunkCount; i++) {
            const chunkKey = `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${i}`;
            await SecureStore.deleteItemAsync(chunkKey);
          }
        }
        await SecureStore.deleteItemAsync(metaKey);
      }
    } catch (error) {
      console.error(
        `[ChunkingSecureStore] Error cleaning up chunks for key ${key}:`,
        error,
      );
      // Best-effort cleanup; don't throw
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
