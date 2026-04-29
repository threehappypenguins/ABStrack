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

  it('falls back to bin when extension contains path or URL-like characters', () => {
    const mk = (extension: string) =>
      createEpisodeMediaObjectKey({
        userId: '6a111111-1111-4111-8111-111111111111',
        episodeId: '7b222222-2222-4222-8222-222222222222',
        mediaType: 'photo',
        extension,
      });
    expect(mk('jpg/extra')).toMatch(/\.bin$/);
    expect(mk('jpg?x=1')).toMatch(/\.bin$/);
    expect(mk('jp:g')).toMatch(/\.bin$/);
    expect(mk('tar.gz')).toMatch(/\.bin$/);
  });

  it('accepts alphanumeric extensions after normalization', () => {
    const key = createEpisodeMediaObjectKey({
      userId: '6a111111-1111-4111-8111-111111111111',
      episodeId: '7b222222-2222-4222-8222-222222222222',
      mediaType: 'photo',
      extension: '.WEBP',
    });
    expect(key.endsWith('.webp')).toBe(true);
  });
});

describe('uploadConfirmedEpisodeMedia', () => {
  it('uploads and inserts episode_media when no row exists', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const single = vi.fn(async () => ({
      data: { id: 'em-1', storage_object_key: 'k' },
      error: null,
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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
    expect(remove).not.toHaveBeenCalled();
  });

  it('after insert, supersede removes Storage keys and deletes older open-pass episode_symptoms', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const single = vi.fn(async () => ({
      data: {
        id: 'em-new',
        user_id: 'u1',
        episode_id: 'ep1',
        episode_symptom_id: 'sx-new',
        storage_object_key: 'u1/ep1/photo-abc.jpg',
        thumbnail_storage_key: null,
        media_type: 'photo',
        duration_seconds: null,
        upload_completed_at: '2020-01-01T00:00:00Z',
        created_at: '2020-01-01T00:00:00Z',
        updated_at: '2020-01-01T00:00:00Z',
      },
      error: null,
    }));

    const symptomQuery = {
      eq: vi.fn(function (this: typeof symptomQuery) {
        return this;
      }),
      neq: vi.fn(function (this: typeof symptomQuery) {
        return this;
      }),
      gt: vi.fn(function (this: typeof symptomQuery) {
        return this;
      }),
      then: (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: [{ id: 'sx-old' }],
          error: null,
        }).then(onFulfilled, onRejected),
    };

    const mediaSelectForObsolete = {
      in: vi.fn(async () => ({
        data: [
          {
            storage_object_key: 'u1/ep1/photo-old.jpg',
            thumbnail_storage_key: null,
          },
        ],
        error: null,
      })),
    };

    const symptomDelete = {
      in: vi.fn(async () => ({ error: null })),
    };

    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'episode_media') {
          return {
            select: vi.fn((cols: string) => {
              if (cols === 'storage_object_key, thumbnail_storage_key') {
                return mediaSelectForObsolete;
              }
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle,
                      })),
                    })),
                  })),
                })),
              };
            }),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single,
              })),
            })),
          };
        }
        if (table === 'episode_symptoms') {
          return {
            select: vi.fn(() => symptomQuery),
            delete: vi.fn(() => symptomDelete),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await uploadConfirmedEpisodeMedia(client, {
      userId: 'u1',
      episodeId: 'ep1',
      episodeSymptomId: 'sx-new',
      mediaType: 'photo',
      body: 'blob',
      contentType: 'image/jpeg',
      extension: 'jpg',
      supersedeOpenPassPresetSymptomAnswers: {
        presetSymptomId: 'preset-line-1',
        lastPostMarkerStepCompletedAt: '2019-12-01T00:00:00Z',
      },
    });

    expect(result.ok).toBe(true);
    expect(remove).toHaveBeenCalledWith(
      expect.arrayContaining(['u1/ep1/photo-old.jpg']),
    );
    expect(symptomDelete.in).toHaveBeenCalledWith('id', ['sx-old']);
  });

  it('still returns ok: true with inserted row when supersede cleanup fails', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const insertedRow = {
      id: 'em-new',
      user_id: 'u1',
      episode_id: 'ep1',
      episode_symptom_id: 'sx-new',
      storage_object_key: 'u1/ep1/photo-abc.jpg',
      thumbnail_storage_key: null,
      media_type: 'photo',
      duration_seconds: null,
      upload_completed_at: '2020-01-01T00:00:00Z',
      created_at: '2020-01-01T00:00:00Z',
      updated_at: '2020-01-01T00:00:00Z',
    };
    const single = vi.fn(async () => ({
      data: insertedRow,
      error: null,
    }));

    const symptomQuery = {
      eq: vi.fn(function (this: typeof symptomQuery) {
        return this;
      }),
      neq: vi.fn(function (this: typeof symptomQuery) {
        return this;
      }),
      gt: vi.fn(function (this: typeof symptomQuery) {
        return this;
      }),
      then: (
        onFulfilled: (v: { data: unknown; error: unknown }) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) =>
        Promise.resolve({
          data: [{ id: 'sx-old' }],
          error: null,
        }).then(onFulfilled, onRejected),
    };

    const mediaSelectForObsolete = {
      in: vi.fn(async () => ({
        data: [
          {
            storage_object_key: 'u1/ep1/photo-old.jpg',
            thumbnail_storage_key: null,
          },
        ],
        error: null,
      })),
    };

    const symptomDelete = {
      in: vi.fn(async () => ({
        error: { message: 'delete superseded failed' },
      })),
    };

    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
        })),
      },
      from: vi.fn((table: string) => {
        if (table === 'episode_media') {
          return {
            select: vi.fn((cols: string) => {
              if (cols === 'storage_object_key, thumbnail_storage_key') {
                return mediaSelectForObsolete;
              }
              return {
                eq: vi.fn(() => ({
                  eq: vi.fn(() => ({
                    order: vi.fn(() => ({
                      limit: vi.fn(() => ({
                        maybeSingle,
                      })),
                    })),
                  })),
                })),
              };
            }),
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single,
              })),
            })),
          };
        }
        if (table === 'episode_symptoms') {
          return {
            select: vi.fn(() => symptomQuery),
            delete: vi.fn(() => symptomDelete),
          };
        }
        throw new Error(`unexpected table ${table}`);
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await uploadConfirmedEpisodeMedia(client, {
      userId: 'u1',
      episodeId: 'ep1',
      episodeSymptomId: 'sx-new',
      mediaType: 'photo',
      body: 'blob',
      contentType: 'image/jpeg',
      extension: 'jpg',
      supersedeOpenPassPresetSymptomAnswers: {
        presetSymptomId: 'preset-line-1',
        lastPostMarkerStepCompletedAt: '2019-12-01T00:00:00Z',
      },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(insertedRow);
    }
    expect(symptomDelete.in).toHaveBeenCalled();
  });

  it('returns ok: false without calling Storage when Web Crypto is unavailable', async () => {
    vi.stubGlobal('crypto', undefined);
    try {
      const upload = vi.fn();
      const client = {
        storage: {
          from: vi.fn(() => ({
            upload,
            remove: vi.fn(async () => ({ data: [], error: null })),
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
        expect(result.error.message).toMatch(
          /Secure media upload is unavailable/,
        );
        const cause = (result.error as Error & { cause?: unknown }).cause as
          | { debugHint?: string }
          | undefined;
        expect(cause?.debugHint).toMatch(
          /react-native-get-random-values|Web Crypto/i,
        );
      }
      expect(upload).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('removes newly uploaded object from Storage when insert fails after upload', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const single = vi.fn(async () => ({
      data: null,
      error: { message: 'insert failed' },
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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

    expect(result.ok).toBe(false);
    expect(upload).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(/^u1\/ep1\/photo-.+\.jpg$/),
    ]);
  });

  it('still returns primary DB error when rollback Storage remove rejects after insert fails', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => {
      throw new Error('storage transport failed');
    });
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const single = vi.fn(async () => ({
      data: null,
      error: { message: 'insert failed' },
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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

    expect(result.ok).toBe(false);
    if (!result.ok) {
      // Primary failure is the DB insert; rollback must not surface the Storage throw.
      expect(result.error.message).not.toMatch(/storage transport/i);
    }
    expect(remove).toHaveBeenCalled();
  });

  it('removes newly uploaded object when existing-row lookup fails after upload', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({
      data: null,
      error: { message: 'select failed' },
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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

    expect(result.ok).toBe(false);
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(/^u1\/ep1\/photo-.+\.jpg$/),
    ]);
  });

  it('removes newly uploaded object when update fails after upload (keeps previous blob)', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'u1/ep1/photo-old.jpg',
      },
      error: null,
    }));
    const single = vi.fn(async () => ({
      data: null,
      error: { message: 'update failed' },
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single,
                })),
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

    expect(result.ok).toBe(false);
    expect(remove).toHaveBeenCalledTimes(1);
    expect(remove).toHaveBeenCalledWith([
      expect.stringMatching(/^u1\/ep1\/photo-.+\.jpg$/),
    ]);
    expect(remove).not.toHaveBeenCalledWith(['u1/ep1/photo-old.jpg']);
  });

  it('removes previous Storage object after update replaces storage_object_key', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'u1/ep1/photo-old.jpg',
      },
      error: null,
    }));
    const single = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'u1/ep1/photo-new.jpg',
        media_type: 'photo',
      },
      error: null,
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single,
                })),
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
    expect(remove).toHaveBeenCalledWith(['u1/ep1/photo-old.jpg']);
  });

  it('normalizes legacy previous storage_object_key before superseded-object remove', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'episode-media/u1/ep1/photo-old.jpg',
      },
      error: null,
    }));
    const single = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'u1/ep1/photo-new.jpg',
        media_type: 'photo',
      },
      error: null,
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single,
                })),
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
    expect(remove).toHaveBeenCalledWith(['u1/ep1/photo-old.jpg']);
  });

  it('normalizes storage: previous key before superseded-object remove', async () => {
    const upload = vi.fn(async () => ({ error: null }));
    const remove = vi.fn(async () => ({ data: [], error: null }));
    const maybeSingle = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'storage:u1/ep1/photo-old.jpg',
      },
      error: null,
    }));
    const single = vi.fn(async () => ({
      data: {
        id: 'em-existing',
        storage_object_key: 'u1/ep1/photo-new.jpg',
        media_type: 'photo',
      },
      error: null,
    }));
    const client = {
      storage: {
        from: vi.fn(() => ({
          upload,
          remove,
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
            update: vi.fn(() => ({
              eq: vi.fn(() => ({
                select: vi.fn(() => ({
                  single,
                })),
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
    expect(remove).toHaveBeenCalledWith(['u1/ep1/photo-old.jpg']);
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
      expect(result.error.message).toMatch(/do not have permission/i);
      const cause = (result.error as Error & { cause?: unknown }).cause as
        | { debugHint?: string }
        | undefined;
      expect(cause?.debugHint).toMatch(/episode-media bucket\/RLS policies/i);
    }
  });

  it('returns ok: false when Storage upload rejects instead of resolving with error', async () => {
    const upload = vi.fn(async () => {
      throw new Error('fetch exploded');
    });
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
      expect(result.error.message.length).toBeGreaterThan(0);
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
      expect(result.error.message).toMatch(/check your connection/i);
      const cause = (result.error as Error & { cause?: unknown }).cause as
        | { debugHint?: string }
        | undefined;
      expect(cause?.debugHint).toMatch(/episode-media bucket\/RLS rules/i);
    }
  });
});

describe('listEpisodeMediaForEpisode', () => {
  it('selects hydration columns and orders by created_at desc then id desc', async () => {
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
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        order: orderFn,
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        select,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listEpisodeMediaForEpisode(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(select).toHaveBeenCalledWith(
      'episode_symptom_id, storage_object_key, upload_completed_at, duration_seconds',
    );
    expect(orderCalls).toEqual([
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
  });

  it('filters by episode_symptom_id when episodeSymptomIds is non-empty', async () => {
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
    const inSpy = vi.fn(() => ({
      order: orderFn,
    }));
    const select = vi.fn(() => ({
      eq: vi.fn(() => ({
        in: inSpy,
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        select,
      })),
    } as unknown as AbstrackSupabaseClient;

    const sid = 'a1111111-1111-4111-8111-111111111111';
    const result = await listEpisodeMediaForEpisode(client, 'ep-1', {
      episodeSymptomIds: [sid],
    });

    expect(result.ok).toBe(true);
    expect(inSpy).toHaveBeenCalledWith('episode_symptom_id', [sid]);
  });

  it('returns empty rows without querying when episodeSymptomIds is empty', async () => {
    const from = vi.fn();
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await listEpisodeMediaForEpisode(client, 'ep-1', {
      episodeSymptomIds: [],
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
    expect(from).not.toHaveBeenCalled();
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
    expect(remove).toHaveBeenCalledTimes(1);
    const calls = remove.mock.calls as unknown as [string[]][];
    const pathsUnknown = calls[0]?.[0] as unknown;
    expect(Array.isArray(pathsUnknown)).toBe(true);
    expect(new Set(pathsUnknown as string[])).toEqual(
      new Set(['u/ep/clip.mp4', 'u/ep/thumb.jpg']),
    );
  });

  it('does not derive remove keys from object URLs when the URL bucket is not episode-media', async () => {
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
                storage_object_key:
                  'https://xyz.supabase.co/storage/v1/object/public/avatars/u/ep/collision.jpg',
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
    expect(remove).not.toHaveBeenCalled();
  });

  it('does not derive remove keys from render URLs when the URL bucket is not episode-media', async () => {
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
                storage_object_key:
                  'https://xyz.supabase.co/storage/v1/render/image/public/avatars/u/ep/thumb.jpg',
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
    expect(remove).not.toHaveBeenCalled();
  });

  it('normalizes Supabase render/image URLs to bucket-relative keys', async () => {
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
                storage_object_key:
                  'https://xyz.supabase.co/storage/v1/render/image/public/episode-media/u/ep/thumb.jpg',
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
    expect(remove).toHaveBeenCalledWith(['u/ep/thumb.jpg']);
  });

  it('normalizes relative /storage/v1/object paths to bucket-relative keys', async () => {
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
                storage_object_key:
                  '/storage/v1/object/public/episode-media/u/ep/a.jpg',
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
    expect(remove).toHaveBeenCalledWith(['u/ep/a.jpg']);
  });

  it('normalizes relative storage/v1/render paths to bucket-relative keys', async () => {
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
                storage_object_key:
                  'storage/v1/render/image/public/episode-media/u/ep/b.jpg',
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
    expect(remove).toHaveBeenCalledWith(['u/ep/b.jpg']);
  });

  it('ignores relative storage/v1 paths when bucket is not episode-media', async () => {
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
                storage_object_key:
                  '/storage/v1/object/public/avatars/u/ep/collision.jpg',
                thumbnail_storage_key:
                  'storage/v1/render/image/public/avatars/u/ep/collision-thumb.jpg',
              },
            ],
            error: null,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await removeEpisodeMediaObjectsFromStorage(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(remove).not.toHaveBeenCalled();
  });

  it('skips Storage remove when every persisted key normalizes to nothing usable', async () => {
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
                storage_object_key: 'https://example.com/unrelated-page',
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
    expect(remove).not.toHaveBeenCalled();
  });
});
