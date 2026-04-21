import { describe, expect, it, vi } from 'vitest';
import type { EpisodeInsert, EpisodeRow } from '@abstrack/types';
import {
  cancelActiveEpisodeById,
  createEpisode,
  deleteEpisodeById,
  endEpisodeIfStillActive,
  getActiveEpisodeForUser,
  getEpisodeById,
  listCompletedEpisodesForUser,
} from './episode-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

describe('createEpisode', () => {
  it('inserts and returns the created row', async () => {
    const inserted: EpisodeInsert = {
      user_id: 'user-1',
      started_at: '2026-04-18T12:00:00.000Z',
      symptom_preset_id: 'sym-1',
      health_marker_preset_id: 'hm-1',
    };
    const returned: EpisodeRow = {
      id: 'ep-1',
      user_id: 'user-1',
      symptom_preset_id: 'sym-1',
      health_marker_preset_id: 'hm-1',
      episode_type: 'Other',
      episode_label: null,
      note: null,
      started_at: inserted.started_at,
      ended_at: null,
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:00.000Z',
    };
    const single = vi.fn(async () => ({
      data: returned,
      error: null,
    }));
    const client = {
      from: vi.fn(() => ({
        insert: vi.fn(() => ({
          select: vi.fn(() => ({
            single,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await createEpisode(client, inserted);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('ep-1');
      expect(result.data.health_marker_preset_id).toBe('hm-1');
    }
    expect(client.from).toHaveBeenCalledWith('episodes');
  });
});

describe('getEpisodeById', () => {
  it('returns the row when present', async () => {
    const row: EpisodeRow = {
      id: 'ep-1',
      user_id: 'user-1',
      symptom_preset_id: 'sym-1',
      health_marker_preset_id: 'hm-1',
      episode_type: 'Other',
      episode_label: null,
      note: null,
      started_at: '2026-04-18T12:00:00.000Z',
      ended_at: null,
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:00.000Z',
    };
    const maybeSingle = vi.fn(async () => ({
      data: row,
      error: null,
    }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await getEpisodeById(client, 'ep-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.id).toBe('ep-1');
    }
  });
});

describe('getActiveEpisodeForUser', () => {
  it('returns the newest active episode for the user', async () => {
    const row: EpisodeRow = {
      id: 'ep-active',
      user_id: 'user-1',
      symptom_preset_id: 'sym-1',
      health_marker_preset_id: 'hm-1',
      episode_type: 'Other',
      episode_label: null,
      note: null,
      started_at: '2026-04-18T14:00:00.000Z',
      ended_at: null,
      created_at: '2026-04-18T14:00:00.000Z',
      updated_at: '2026-04-18T14:00:00.000Z',
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => ({ data: row, error: null })),
                })),
              })),
            })),
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await getActiveEpisodeForUser(client, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data?.id).toBe('ep-active');
      expect(result.data?.ended_at).toBeNull();
    }
    expect(client.from).toHaveBeenCalledWith('episodes');
  });

  it('returns null when no active episode exists', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              order: vi.fn(() => ({
                limit: vi.fn(() => ({
                  maybeSingle,
                })),
              })),
            })),
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await getActiveEpisodeForUser(client, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBeNull();
    }
  });
});

describe('listCompletedEpisodesForUser', () => {
  it('returns completed episodes ordered by ended_at desc, id desc', async () => {
    const rows: EpisodeRow[] = [
      {
        id: 'ep-2',
        user_id: 'user-1',
        symptom_preset_id: 'sym-1',
        health_marker_preset_id: null,
        episode_type: 'ABS',
        episode_label: 'Morning',
        note: null,
        started_at: '2026-04-19T10:00:00.000Z',
        ended_at: '2026-04-19T11:00:00.000Z',
        created_at: '2026-04-19T10:00:00.000Z',
        updated_at: '2026-04-19T11:00:00.000Z',
      },
      {
        id: 'ep-1',
        user_id: 'user-1',
        symptom_preset_id: 'sym-1',
        health_marker_preset_id: null,
        episode_type: 'Other',
        episode_label: null,
        note: null,
        started_at: '2026-04-18T08:00:00.000Z',
        ended_at: '2026-04-18T09:30:00.000Z',
        created_at: '2026-04-18T08:00:00.000Z',
        updated_at: '2026-04-18T09:30:00.000Z',
      },
    ];
    const limit = vi.fn(async () => ({ data: rows, error: null }));
    const queryBuilder = {
      order: vi.fn(() => queryBuilder),
      limit,
    };
    const notFn = vi.fn(() => queryBuilder);
    const eq = vi.fn(() => ({ not: notFn }));
    const select = vi.fn(() => ({ eq }));
    const client = {
      from: vi.fn(() => ({ select })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listCompletedEpisodesForUser(client, 'user-1', {
      limit: 25,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0]?.id).toBe('ep-2');
    }
    expect(client.from).toHaveBeenCalledWith('episodes');
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(notFn).toHaveBeenCalledWith('ended_at', 'is', null);
    expect(queryBuilder.order).toHaveBeenNthCalledWith(1, 'ended_at', {
      ascending: false,
    });
    expect(queryBuilder.order).toHaveBeenNthCalledWith(2, 'id', {
      ascending: false,
    });
    expect(limit).toHaveBeenCalledWith(25);
  });
});

describe('endEpisodeIfStillActive', () => {
  it('updates ended_at when the row is still active', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: 'ep-1' },
      error: null,
    }));
    const client = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle,
              })),
            })),
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await endEpisodeIfStillActive(
      client,
      'ep-1',
      '2026-04-20T12:00:00.000Z',
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.didEnd).toBe(true);
    }
    expect(client.from).toHaveBeenCalledWith('episodes');
  });

  it('returns didEnd false when the row was already ended (no row returned)', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const client = {
      from: vi.fn(() => ({
        update: vi.fn(() => ({
          eq: vi.fn(() => ({
            is: vi.fn(() => ({
              select: vi.fn(() => ({
                maybeSingle,
              })),
            })),
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await endEpisodeIfStillActive(client, 'ep-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.didEnd).toBe(false);
    }
  });
});

describe('cancelActiveEpisodeById', () => {
  it('deletes the row when it is still active', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: 'ep-1' },
      error: null,
    }));
    const is = vi.fn(() => ({
      select: vi.fn(() => ({
        maybeSingle,
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            is,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await cancelActiveEpisodeById(client, 'ep-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.didCancel).toBe(true);
    }
    expect(client.from).toHaveBeenCalledWith('episodes');
    expect(is).toHaveBeenCalledWith('ended_at', null);
  });

  it('returns didCancel false when the row was already ended (no row returned)', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const is = vi.fn(() => ({
      select: vi.fn(() => ({
        maybeSingle,
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            is,
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await cancelActiveEpisodeById(client, 'ep-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.didCancel).toBe(false);
    }
    expect(is).toHaveBeenCalledWith('ended_at', null);
  });
});

describe('deleteEpisodeById', () => {
  it('deletes the row regardless of ended_at state', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: 'ep-2' },
      error: null,
    }));
    const client = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle,
            })),
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await deleteEpisodeById(client, 'ep-2');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.didDelete).toBe(true);
    }
    expect(client.from).toHaveBeenCalledWith('episodes');
  });

  it('returns didDelete false when no row is visible/matched', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
    const client = {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              maybeSingle,
            })),
          })),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await deleteEpisodeById(client, 'ep-missing');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.didDelete).toBe(false);
    }
  });
});
