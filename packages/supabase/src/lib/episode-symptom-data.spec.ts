import { describe, expect, it, vi } from 'vitest';
import type { PresetSymptomRow } from '@abstrack/types';
import { upsertEpisodeSymptomAnswer } from './episode-symptom-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const line: PresetSymptomRow = {
  id: 'ps-line-1',
  preset_id: 'preset-1',
  sort_order: 0,
  symptom_name: 'Nausea',
  response_type: 'yes_no',
  prompt_instruction: null,
  created_at: '2026-04-18T12:00:00.000Z',
  updated_at: '2026-04-18T12:00:00.000Z',
};

/** Matches `.select().eq().eq().order().order()` from `fetchEpisodeSymptomRowsForLine`. */
function chainSelectEpisodeLine(data: unknown): Record<string, unknown> {
  return {
    select: vi.fn(() => ({
      eq: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(async () => ({ data, error: null })),
          })),
        })),
      })),
    })),
  };
}

describe('upsertEpisodeSymptomAnswer', () => {
  it('inserts when no existing row', async () => {
    const inserted = {
      id: 'es-1',
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_symptom_id: line.id,
      symptom_name: line.symptom_name,
      response_type: 'yes_no',
      response_boolean: true,
      response_severity: null,
      response_text: null,
      sort_order: 0,
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:00.000Z',
    };
    let fromCalls = 0;
    const client = {
      from: vi.fn((table: string) => {
        fromCalls += 1;
        if (fromCalls === 1) {
          expect(table).toBe('episode_symptoms');
          return chainSelectEpisodeLine([]);
        }
        return {
          insert: vi.fn(() => ({
            select: vi.fn(() => ({
              single: vi.fn(async () => ({
                data: inserted,
                error: null,
              })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeSymptomAnswer(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      answer: { type: 'yes_no', value: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response_boolean).toBe(true);
    }
    expect(fromCalls).toBe(2);
  });

  it('updates when a row exists', async () => {
    const existingId = 'existing-es';
    const updated = {
      id: existingId,
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_symptom_id: line.id,
      symptom_name: line.symptom_name,
      response_type: 'yes_no',
      response_boolean: false,
      response_severity: null,
      response_text: null,
      sort_order: 0,
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:01:00.000Z',
    };
    let fromCalls = 0;
    const client = {
      from: vi.fn(() => {
        fromCalls += 1;
        if (fromCalls === 1) {
          return chainSelectEpisodeLine([
            {
              id: existingId,
              user_id: 'u1',
              episode_id: 'ep-1',
              preset_symptom_id: line.id,
              created_at: '2026-04-18T12:00:00.000Z',
            },
          ]);
        }
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: updated,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeSymptomAnswer(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      answer: { type: 'yes_no', value: false },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response_boolean).toBe(false);
    }
    expect(fromCalls).toBe(2);
  });

  it('deletes duplicate rows then updates the oldest', async () => {
    const keepId = 'es-keep';
    const dropId = 'es-drop';
    const updated = {
      id: keepId,
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_symptom_id: line.id,
      symptom_name: line.symptom_name,
      response_type: 'yes_no',
      response_boolean: true,
      response_severity: null,
      response_text: null,
      sort_order: 0,
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:02:00.000Z',
    };
    let fromCalls = 0;
    const client = {
      from: vi.fn(() => {
        fromCalls += 1;
        if (fromCalls === 1) {
          return chainSelectEpisodeLine([
            {
              id: keepId,
              user_id: 'u1',
              episode_id: 'ep-1',
              preset_symptom_id: line.id,
              created_at: '2026-04-18T12:00:00.000Z',
            },
            {
              id: dropId,
              user_id: 'u1',
              episode_id: 'ep-1',
              preset_symptom_id: line.id,
              created_at: '2026-04-18T12:00:01.000Z',
            },
          ]);
        }
        if (fromCalls === 2) {
          return {
            delete: vi.fn(() => ({
              in: vi.fn(async () => ({ error: null })),
            })),
          };
        }
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: updated,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeSymptomAnswer(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      answer: { type: 'yes_no', value: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(keepId);
    }
    expect(fromCalls).toBe(3);
  });

  it('on insert unique violation (23505), refetches and updates the concurrent row', async () => {
    const raceRowId = 'es-concurrent';
    const afterUpdate = {
      id: raceRowId,
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_symptom_id: line.id,
      symptom_name: line.symptom_name,
      response_type: 'yes_no' as const,
      response_boolean: true,
      response_severity: null,
      response_text: null,
      sort_order: 0,
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:01.000Z',
    };
    let fromCalls = 0;
    const client = {
      from: vi.fn(() => {
        fromCalls += 1;
        if (fromCalls === 1) {
          return chainSelectEpisodeLine([]);
        }
        if (fromCalls === 2) {
          return {
            insert: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: null,
                  error: { code: '23505', message: 'duplicate key value' },
                })),
              })),
            })),
          };
        }
        if (fromCalls === 3) {
          return chainSelectEpisodeLine([
            {
              id: raceRowId,
              user_id: 'u1',
              episode_id: 'ep-1',
              preset_symptom_id: line.id,
              created_at: '2026-04-18T12:00:00.000Z',
            },
          ]);
        }
        return {
          update: vi.fn(() => ({
            eq: vi.fn(() => ({
              select: vi.fn(() => ({
                single: vi.fn(async () => ({
                  data: afterUpdate,
                  error: null,
                })),
              })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeSymptomAnswer(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      answer: { type: 'yes_no', value: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(raceRowId);
      expect(result.data.response_boolean).toBe(true);
    }
    expect(fromCalls).toBe(4);
  });
});
