import { describe, expect, it, vi } from 'vitest';
import type { PresetSymptomRow } from '@abstrack/types';
import {
  deleteCurrentPassEpisodeSymptomAnswer,
  insertEpisodeSymptomAnswer,
  listEpisodeSymptomsForEpisode,
} from './episode-symptom-data.js';
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

describe('listEpisodeSymptomsForEpisode', () => {
  it('orders by sort_order asc, then created_at desc, then id desc', async () => {
    const orderCalls: { column: string; ascending: boolean }[] = [];
    const orderFn = vi.fn((column: string, opts?: { ascending?: boolean }) => {
      orderCalls.push({
        column,
        ascending: opts?.ascending ?? true,
      });
      if (orderCalls.length < 3) {
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

    const result = await listEpisodeSymptomsForEpisode(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(orderCalls).toEqual([
      { column: 'sort_order', ascending: true },
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
  });
});

describe('insertEpisodeSymptomAnswer', () => {
  it('returns validation_error when answer.type does not match line.response_type', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeSymptomAnswer(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: { ...line, response_type: 'free_text' },
      answer: { type: 'yes_no', value: true },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('symptom line');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('inserts a new row', async () => {
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
    const client = {
      from: vi.fn((table: string) => {
        expect(table).toBe('episode_symptoms');
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

    const result = await insertEpisodeSymptomAnswer(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      answer: { type: 'yes_no', value: true },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response_boolean).toBe(true);
    }
  });
});

describe('deleteCurrentPassEpisodeSymptomAnswer', () => {
  it('deletes all rows in the current pass for that preset line', async () => {
    const inDelete = vi.fn(async () => ({ error: null }));
    let fromCalls = 0;
    const client = {
      from: vi.fn((table: string) => {
        expect(table).toBe('episode_symptoms');
        fromCalls += 1;
        if (fromCalls === 1) {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(async () => ({
                  data: [
                    { id: 'a', created_at: '2026-04-20T12:00:00.000Z' },
                    { id: 'b', created_at: '2026-04-21T12:00:00.000Z' },
                  ],
                  error: null,
                })),
              })),
            })),
          };
        }
        return {
          delete: vi.fn(() => ({
            in: inDelete,
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await deleteCurrentPassEpisodeSymptomAnswer(client, {
      episodeId: 'ep-1',
      presetSymptomId: 'ps-line-1',
      lastPostMarkerStepCompletedAt: '2026-04-19T00:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(inDelete).toHaveBeenCalledWith('id', ['a', 'b']);
  });
});
