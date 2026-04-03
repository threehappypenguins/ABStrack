import * as SecureStore from 'expo-secure-store';
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

    test('handles exact 2044-byte boundary (internal chunk size)', async () => {
      // Exactly 2044 bytes (internal CHUNK_SIZE with 4-byte UTF-8 safety margin)
      const boundaryValue = 'x'.repeat(2044);

      await mobileAuthStorage.setItem('auth-session', boundaryValue);
      const retrieved = await mobileAuthStorage.getItem('auth-session');

      expect(retrieved).toBe(boundaryValue);
      expect(mockStore['auth-session.meta']).toBeUndefined(); // Not chunked
    });

    test('stores just over 2044 bytes as chunks', async () => {
      const overshootValue = 'x'.repeat(2045);

      await mobileAuthStorage.setItem('auth-session', overshootValue);

      expect(mockStore['auth-session']).toBeUndefined();
      expect(mockStore['auth-session.meta']).toBe('2'); // 2 chunks
      expect(mockStore['auth-session.chunk.0']).toBeDefined();
      expect(mockStore['auth-session.chunk.1']).toBeDefined();
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
      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBeNull();
    });

    test('handles missing chunks gracefully', async () => {
      mockStore['auth-session.meta'] = '3';
      mockStore['auth-session.chunk.0'] = 'chunk0';
      mockStore['auth-session.chunk.1'] = 'chunk1';
      // chunk.2 missing

      const result = await mobileAuthStorage.getItem('auth-session');

      expect(result).toBeNull();
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
  });
});
