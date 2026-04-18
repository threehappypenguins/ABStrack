import { describe, expect, it, vi } from 'vitest';
import type { EpisodeInsert, EpisodeRow } from '@abstrack/types';
import { createEpisode } from './episode-data.js';
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
