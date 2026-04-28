import { describe, expect, it, vi } from 'vitest';
import {
  createEpisodeMediaObjectKey,
  listEpisodeMediaForEpisode,
  removeEpisodeMediaObjectsFromStorage,
  uploadConfirmedEpisodeMedia,
} from './episode-media-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

describe('createEpisodeMediaObjectKey', () => {
  it('uses required user/episode path prefix', () => {
    const key = createEpisodeMediaObjectKey({
      userId: '6a111111-1111-4111-8111-111111111111',
      episodeId: '7b222222-2222-4222-8222-222222222222',
      mediaType: 'photo',
      extension: '.jpg',
    });
    expect(
      key.startsWith(
        '6a111111-1111-4111-8111-111111111111/7b222222-2222-4222-8222-222222222222/photo-',
      ),
    ).toBe(true);
    expect(key.endsWith('.jpg')).toBe(true);
  });
});

describe('uploadConfirmedEpisodeMedia', () => {
  it('uploads and inserts episode_media when no row exists', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const single = vi.fn(async () => ({
      data: { id: 'em-1', storage_object_key: 'k' },
      error: null,
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'episode_media') {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => ({
                      maybeSingle,
                    })),
                  })),
                })),
              })),
            })),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single,
              })),
            })),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await uploadConfirmedEpisodeMedia(client, {
      userId: 'u1',
      episodeId: 'ep1',
      episodeSymptomId: 'sx1',
      mediaType: 'photo',
      body: 'blob',
      contentType: 'image/jpeg',
      extension: 'jpg',
    });

    expect(result.ok).toBe(true);
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it('maps Storage 403 to permission_denied', async () => {
    const upload = vi.fn(async () => ({
      error: { statusCode: '403', message: 'policy violation' },
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
        })),
      },
      from: vi.fn(() => {
        throw new Error('unexpected DB during upload failure test');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await uploadConfirmedEpisodeMedia(client, {
      userId: 'u1',
      episodeId: 'ep1',
      episodeSymptomId: 'sx1',
      mediaType: 'photo',
      body: 'blob',
      contentType: 'image/jpeg',
      extension: 'jpg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('permission_denied');
      expect(result.error.message).toMatch(/Storage/i);
    }
  });

  it('does not blame generic connectivity when RN reports transport failure on upload', async () => {
    const upload = vi.fn(async () => ({
      error: new Error('Network request failed'),
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
        })),
      },
      from: vi.fn(() => {
        throw new Error('unexpected DB');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await uploadConfirmedEpisodeMedia(client, {
      userId: 'u1',
      episodeId: 'ep1',
      episodeSymptomId: 'sx1',
      mediaType: 'photo',
      body: 'blob',
      contentType: 'image/jpeg',
      extension: 'jpg',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('network_error');
      expect(result.error.message).toMatch(/media file/i);
      expect(result.error.message).toMatch(/Storage/i);
      expect(result.error.message).not.toMatch(/Check your connection/i);
    }
  });
});

describe('listEpisodeMediaForEpisode', () => {
  it('orders by created_at desc then id desc', async () => {
    const orderCalls: { column: string; ascending: boolean }[] = [];
    const orderFn = vi.fn((column: string, opts?: { ascending?: boolean }) => {
      orderCalls.push({
        column,
        ascending: opts?.ascending ?? true,
      });
      if (orderCalls.length < 2) {
        return { order: orderFn };
      }
      return Promise.resolve({ data: [], error: null });
    });
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: orderFn,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listEpisodeMediaForEpisode(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(orderCalls).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
  });
});

describe('removeEpisodeMediaObjectsFromStorage', () => {
  it('calls Storage remove with deduped keys when episode_media has rows', async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const client = {
      storage: {
        from: vi.fn(() => ({ remove })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [
              {
                storage_object_key: 'u/ep/a.jpg',
                thumbnail_storage_key: 'u/ep/t.jpg',
              },
              {
                storage_object_key: 'u/ep/a.jpg',
                thumbnail_storage_key: null,
              },
            ],
            error: null,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await removeEpisodeMediaObjectsFromStorage(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(['u/ep/a.jpg', 'u/ep/t.jpg']);
  });

  it('skips Storage remove when there are no keys', async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const client = {
      storage: {
        from: vi.fn(() => ({ remove })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({ data: [], error: null })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await removeEpisodeMediaObjectsFromStorage(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it('normalizes legacy keys before remove', async () => {
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const client = {
      storage: {
        from: vi.fn(() => ({ remove })),
      },
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(async () => ({
            data: [
              {
                storage_object_key: 'episode-media/u/ep/clip.mp4',
                thumbnail_storage_key:
                  'https://xyz.supabase.co/storage/v1/object/public/episode-media/u/ep/thumb.jpg',
              },
            ],
            error: null,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await removeEpisodeMediaObjectsFromStorage(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(
      expect.arrayContaining([
        'episode-media/u/ep/clip.mp4',
        'u/ep/clip.mp4',
        'u/ep/thumb.jpg',
      ]),
    );
  });
});
