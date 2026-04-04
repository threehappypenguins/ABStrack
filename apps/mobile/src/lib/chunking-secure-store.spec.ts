import * as SecureStore from 'expo-secure-store';
import { Base64 } from 'js-base64';
import { mobileAuthStorage } from './supabase-wiring';

// Since ChunkingSecureStore is not exported, we'll test it via the public adapter interface
// by mocking SecureStore and verifying the chunking behavior indirectly

describe('ChunkingSecureStore (via supabase-wiring)', () => {
  let mockStore: Record<string, string>;

  beforeEach(() => {
    mockStore = {};
    jest.spyOn(SecureStore, 'getItemAsync').mockImplementation((key: string) => {
      return Promise.resolve(mockStore[key] ?? null);
    });

    jest.spyOn(SecureStore, 'setItemAsync').mockImplementation((key: string, value: string) => {
      // Simulate 2KB limit: throw if value exceeds limit
      if (Buffer.byteLength(value, 'utf-8') > 2048) {
        throw new Error(`Value exceeds 2048 byte limit for key: ${key}`);
      }
      mockStore[key] = value;
      return Promise.resolve();
    });

    jest.spyOn(SecureStore, 'deleteItemAsync').mockImplementation((key: string) => {
      delete mockStore[key];
      return Promise.resolve();
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('ChunkingSecureStore adapter', () => {
    test('stores small values without chunking', async () => {
      const smallValue = 'short auth token';

      await mobileAuthStorage.setItem('auth-session', smallValue);

      expect(mockStore['auth-session']).toBe(smallValue);
      expect(mockStore['auth-session.meta']).toBeUndefined();
    });

    test('chunks large values exceeding 2048 bytes', async () => {
      // Create a 5KB payload (typical Supabase session with user_metadata)
      const largeValue = JSON.stringify({
        access_token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9' + 'x'.repeat(500),
        refresh_token: 'sbv1_' + 'y'.repeat(500),
        user: {
          id: 'user-id',
          email: 'patient@example.com',
          user_metadata: {
            full_name: 'Jane Doe',
            age_range: '25-34',
            mobility_impairment: true,
            accommodation_notes: 'z'.repeat(1000),
          },
          app_metadata: {},
        },
      });

      await mobileAuthStorage.setItem('auth-session', largeValue);

      // Should create chunk keys and metadata
      expect(mockStore['auth-session']).toBeUndefined(); // Not stored as single value
      expect(mockStore['auth-session.meta']).toBeDefined();
      expect(mockStore['auth-session.chunk.0']).toBeDefined();
      expect(mockStore['auth-session.chunk.1']).toBeDefined();
      // Chunks should not exceed 2048 bytes individually
      expect(Buffer.byteLength(mockStore['auth-session.chunk.0'], 'utf-8')).toBeLessThanOrEqual(
        2048,
      );
    });

    test('reassembles chunked values on read', async () => {
      const largeValue = 'x'.repeat(5000);

      await mobileAuthStorage.setItem('auth-session', largeValue);
      const retrieved = await mobileAuthStorage.getItem('auth-session');

      expect(retrieved).toBe(largeValue);
    });

    test('stores small values directly without chunking', async () => {
      // Small value: direct string storage path (no chunking metadata)
      const smallValue = 'x'.repeat(1500);

      await mobileAuthStorage.setItem('auth-session', smallValue);
      const retrieved = await mobileAuthStorage.getItem('auth-session');

      expect(retrieved).toBe(smallValue);
      expect(mockStore['auth-session']).toBeDefined(); // Stored directly (not chunked)
      expect(mockStore['auth-session.meta']).toBeUndefined(); // No metadata
    });

    test('chunks values that exceed 2044 bytes when base64-encoded', async () => {
      // ~1600 chars → ~2133 bytes when base64-encoded → exceeds 2044-byte limit → needs chunking
      const largeValue = 'x'.repeat(1600);

      await mobileAuthStorage.setItem('auth-session', largeValue);
      const retrieved = await mobileAuthStorage.getItem('auth-session');

      expect(retrieved).toBe(largeValue);
      expect(mockStore['auth-session']).toBeUndefined(); // Not stored as single value
      expect(mockStore['auth-session.meta']).toBeDefined(); // Metadata present (chunked)
      expect(mockStore['auth-session.chunk.0']).toBeDefined(); // First chunk exists
      expect(mockStore['auth-session.chunk.1']).toBeDefined(); // Second chunk exists
    });

    test('rolls back partial chunked writes when SecureStore throws mid-write', async () => {
      const largeValue = 'x'.repeat(5000);
      let writeCount = 0;

      (SecureStore.setItemAsync as jest.Mock).mockImplementation(
        (key: string, value: string) => {
          if (Buffer.byteLength(value, 'utf-8') > 2048) {
            throw new Error(`Value exceeds 2048 byte limit for key: ${key}`);
          }

          writeCount += 1;
          if (writeCount === 3) {
            throw new Error('Simulated SecureStore failure');
          }

          mockStore[key] = value;
          return Promise.resolve();
        },
      );

      await expect(mobileAuthStorage.setItem('auth-session', largeValue)).rejects.toThrow(
        'Simulated SecureStore failure',
      );

      expect(mockStore['auth-session']).toBeUndefined();
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
      expect(mockStore['auth-session.chunk.1']).toBeUndefined();
    });

    test('removes all chunks when removing a key', async () => {
      const largeValue = 'x'.repeat(5000);

      await mobileAuthStorage.setItem('auth-session', largeValue);
      expect(mockStore['auth-session.meta']).toBeDefined();
      expect(mockStore['auth-session.chunk.0']).toBeDefined();

      await mobileAuthStorage.removeItem('auth-session');

      expect(mockStore['auth-session']).toBeUndefined();
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
    });

    test('returns null for missing key', async () => {
      const result = await mobileAuthStorage.getItem('nonexistent-key');

      expect(result).toBeNull();
    });

    test('handles corrupted metadata gracefully', async () => {
      mockStore['auth-session.meta'] = 'invalid-number';
      mockStore['auth-session.chunk.0'] = 'chunk0';
      mockStore['auth-session.chunk.1'] = 'chunk1';
      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBeNull();
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
      expect(mockStore['auth-session.chunk.1']).toBeUndefined();
    });

    test('falls back to main key when corrupted metadata exists with valid direct value', async () => {
      mockStore['auth-session'] = 'direct-session-value';
      mockStore['auth-session.meta'] = 'invalid-number';

      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBe('direct-session-value');
      expect(mockStore['auth-session.meta']).toBeUndefined();
    });

    test('bounds cleanup when metadata parses to an implausibly large chunk count', async () => {
      mockStore['auth-session.meta'] = '999999';
      mockStore['auth-session.chunk.0'] = 'chunk0';

      const getItemSpy = SecureStore.getItemAsync as jest.Mock;
      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBeNull();
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
      expect(getItemSpy).not.toHaveBeenCalledWith('auth-session.chunk.32');
    });

    test('handles missing chunks gracefully', async () => {
      mockStore['auth-session.meta'] = '3';
      mockStore['auth-session.chunk.0'] = 'chunk0';
      mockStore['auth-session.chunk.1'] = 'chunk1';
      // chunk.2 missing

      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBeNull();
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
      expect(mockStore['auth-session.chunk.1']).toBeUndefined();
    });

    test('falls back to main key when chunk metadata is stale', async () => {
      mockStore['auth-session'] = 'direct-session-value';
      mockStore['auth-session.meta'] = '3';
      mockStore['auth-session.chunk.0'] = 'chunk0';
      mockStore['auth-session.chunk.1'] = 'chunk1';
      // chunk.2 missing

      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBe('direct-session-value');
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
      expect(mockStore['auth-session.chunk.1']).toBeUndefined();
    });

    test('cleans up chunk state and falls back to main key when base64 decode fails', async () => {
      mockStore['auth-session'] = 'direct-session-value';
      mockStore['auth-session.meta'] = '1';
      mockStore['auth-session.chunk.0'] = 'YWJj';

      jest.spyOn(Base64, 'decode').mockImplementation(() => {
        throw new Error('Corrupted base64 payload');
      });

      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBe('direct-session-value');
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
    });

    test('replaces chunked value with smaller value', async () => {
      const largeValue = 'x'.repeat(5000);
      const smallValue = 'small';

      await mobileAuthStorage.setItem('auth-session', largeValue);
      expect(mockStore['auth-session.meta']).toBeDefined();

      await mobileAuthStorage.setItem('auth-session', smallValue);

      expect(mockStore['auth-session']).toBe(smallValue);
      expect(mockStore['auth-session.meta']).toBeUndefined();
      expect(mockStore['auth-session.chunk.0']).toBeUndefined();
    });

    test('preserves multi-byte UTF-8 characters across chunk boundaries', async () => {
      // Create a chunked value (~1600 chars) with multi-byte UTF-8 sequences
      // This value will be split into multiple chunks at arbitrary byte positions,
      // but base64 encoding ensures no UTF-8 sequences are split.
      // The original UTF-8 string must round-trip exactly after chunking/dechunking.
      const multibyteValue = JSON.stringify({
        user_metadata: {
          // Emoji (4 bytes each): 🏥 💊 ♿
          full_name: 'Françoise Müller 🏥 Patient',
          // Accented characters (2-3 bytes): é, ñ, ü, etc.
          locale: 'fr-FR',
          notes: 'Consultation: ' + '日本語テスト中文测试'.repeat(100), // Japanese/Chinese (3-4 bytes per char)
          // Mixed ASCII + emoji + accents spread across ~1600 chars
          description: 'This patient 👤 uses assistive technology. ' + '🦽 ♿ 👨‍🦯'.repeat(150),
        },
      });

      // Verify the test data is large enough to require chunking
      expect(multibyteValue.length).toBeGreaterThan(1500);

      // Store and retrieve
      await mobileAuthStorage.setItem('auth-session', multibyteValue);
      const retrieved = await mobileAuthStorage.getItem('auth-session');

      // CRITICAL: Verify exact round-trip (no corruption, no replacement characters)
      expect(retrieved).toBe(multibyteValue);

      // Verify it was actually chunked (not stored as single value)
      expect(mockStore['auth-session']).toBeUndefined();
      const metaValue = mockStore['auth-session.meta'];
      expect(metaValue).toBeDefined();
      const chunkCount = parseInt(metaValue!, 10);
      expect(chunkCount).toBeGreaterThanOrEqual(2); // Should require multiple chunks
      expect(mockStore['auth-session.chunk.0']).toBeDefined();
      expect(mockStore['auth-session.chunk.1']).toBeDefined();

      // Verify no corruption for common multi-byte sequences
      expect(retrieved).toContain('Françoise Müller 🏥 Patient');
      expect(retrieved).toContain('日本語テスト中文测试');
      expect(retrieved).toContain('👤');
      expect(retrieved).toContain('🦽');
    });
  });
});
