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
      from: vi.fn(() => {
        fromCalls += 1;
        if (fromCalls === 1) {
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(async () => ({
                    data: [],
                    error: null,
                  })),
                })),
              })),
            })),
          };
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
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                eq: vi.fn(() => ({
                  limit: vi.fn(async () => ({
                    data: [
                      {
                        id: existingId,
                        user_id: 'u1',
                        episode_id: 'ep-1',
                        preset_symptom_id: line.id,
                      },
                    ],
                    error: null,
                  })),
                })),
              })),
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
      answer: { type: 'yes_no', value: false },
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.response_boolean).toBe(false);
    }
    expect(fromCalls).toBe(2);
  });
});
