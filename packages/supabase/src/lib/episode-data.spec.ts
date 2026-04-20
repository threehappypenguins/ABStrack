import { describe, expect, it, vi } from 'vitest';
import type { EpisodeInsert, EpisodeRow } from '@abstrack/types';
import {
  createEpisode,
  getActiveEpisodeForUser,
  getEpisodeById,
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
