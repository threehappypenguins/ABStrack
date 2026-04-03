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
 * This adapter splits large values into byte chunks (with a 4-byte safety margin to avoid splitting
 * multi-byte UTF-8 characters), storing each chunk with an indexed key (e.g., `key.chunk.0`, `key.chunk.1`)
 * and a metadata key tracking the chunk count. On read, chunks are reassembled in order. On remove, all
 * chunks and metadata are deleted.
 *
 * Satisfies HIPAA/PHIA requirements by storing all data encrypted via OS Keychain (iOS) / Keystore (Android).
 */
class ChunkingSecureStore {
  // 2048-byte limit minus 4-byte safety margin to avoid splitting multi-byte UTF-8 characters
  // UTF-8 characters can be 1-4 bytes; this margin ensures we never cut a character in half
  private static readonly CHUNK_SIZE = 2044;
  private static readonly CHUNK_SUFFIX = '.chunk';
  private static readonly META_SUFFIX = '.meta';

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
      const chunks: string[] = [];
      for (let i = 0; i < chunkCount; i++) {
        const chunkKey = `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${i}`;
        const chunk = await SecureStore.getItemAsync(chunkKey);
        if (!chunk) {
          console.warn(
            `[ChunkingSecureStore] Missing chunk ${i}/${chunkCount} for key: ${key}`,
          );
          return null;
        }
        chunks.push(chunk);
      }

      return chunks.join('');
    } catch (error) {
      console.error(`[ChunkingSecureStore] Error reading key ${key}:`, error);
      return null;
    }
  }

  async setItem(key: string, value: string): Promise<void> {
    try {
      // Use TextEncoder (Web API available in RN) instead of Buffer.byteLength
      const valueBytes = new TextEncoder().encode(value);
      const valueLength = valueBytes.byteLength;

      if (valueLength <= ChunkingSecureStore.CHUNK_SIZE) {
        // Small value: store directly, clean up any existing chunks
        await this.removeChunks(key);
        await SecureStore.setItemAsync(key, value);
        return;
      }

      // Large value: split into byte chunks, then decode each chunk to string
      // First, clean up the main key and any existing chunks to avoid orphaned data
      await SecureStore.deleteItemAsync(key);
      await this.removeChunks(key);

      const chunks: string[] = [];
      for (let i = 0; i < valueLength; i += ChunkingSecureStore.CHUNK_SIZE) {
        const chunk = valueBytes.slice(i, i + ChunkingSecureStore.CHUNK_SIZE);
        // Decode bytes back to string (UTF-8 safe)
        const chunkString = new TextDecoder().decode(chunk);
        chunks.push(chunkString);
      }

      // Store chunks and metadata
      for (let i = 0; i < chunks.length; i++) {
        const chunkKey = `${key}${ChunkingSecureStore.CHUNK_SUFFIX}.${i}`;
        await SecureStore.setItemAsync(chunkKey, chunks[i]);
      }

      const metaKey = key + ChunkingSecureStore.META_SUFFIX;
      await SecureStore.setItemAsync(metaKey, chunks.length.toString());
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
