import { describe, expect, it, vi } from 'vitest';
import type { PresetHealthMarkerRow } from '@abstrack/types';
import {
  listEpisodeHealthMarkersForEpisode,
  upsertEpisodeHealthMarkerForLine,
} from './episode-health-marker-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const line: PresetHealthMarkerRow = {
  id: 'phm-1',
  preset_id: 'hm-preset-1',
  sort_order: 0,
  marker_kind: 'blood_glucose',
  custom_name: null,
  custom_unit: null,
  created_at: '2026-04-18T12:00:00.000Z',
  updated_at: '2026-04-18T12:00:00.000Z',
};

describe('listEpisodeHealthMarkersForEpisode', () => {
  it('orders by recorded_at desc, then created_at desc, then id desc', async () => {
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

    const result = await listEpisodeHealthMarkersForEpisode(client, 'ep-1');

    expect(result.ok).toBe(true);
    expect(orderCalls).toEqual([
      { column: 'recorded_at', ascending: false },
      { column: 'created_at', ascending: false },
      { column: 'id', ascending: false },
    ]);
  });
});

describe('upsertEpisodeHealthMarkerForLine', () => {
  it('returns validation_error when custom line is missing fields', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: {
        ...line,
        marker_kind: 'custom',
        custom_name: '  ',
        custom_unit: null,
      },
      valueNumeric: 1,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('Enter a name');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('updates newest matching row when one exists', async () => {
    const existingId = 'hm-existing';
    const updated = {
      id: existingId,
      user_id: 'u1',
      episode_id: 'ep-1',
      marker_kind: 'blood_glucose',
      custom_name: null,
      custom_unit: null,
      value_numeric: 120,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: null,
      recorded_at: '2026-04-18T12:05:00.000Z',
      created_at: '2026-04-18T12:05:00.000Z',
      updated_at: '2026-04-18T12:05:00.000Z',
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
                  is: vi.fn(() => ({
                    is: vi.fn(() => ({
                      order: vi.fn(() => ({
                        order: vi.fn(() => ({
                          order: vi.fn(() => ({
                            limit: vi.fn(async () => ({
                              data: [{ id: existingId }],
                              error: null,
                            })),
                          })),
                        })),
                      })),
                    })),
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
                single: vi.fn(async () => ({ data: updated, error: null })),
              })),
            })),
          })),
        };
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      valueNumeric: 120,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(existingId);
      expect(result.data.value_numeric).toBe(120);
    }
    expect(fromCalls).toBe(2);
  });
});
