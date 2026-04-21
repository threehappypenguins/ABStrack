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

  it('upserts (updates on conflict) when a row already exists for the line signature', async () => {
    const existingId = 'hm-existing';
    const updated = {
      id: existingId,
      user_id: 'u1',
      episode_id: 'ep-1',
      marker_kind: 'blood_glucose',
      custom_name: null,
      custom_unit: null,
      custom_name_key: '',
      custom_unit_key: '',
      value_numeric: 120,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: null,
      recorded_at: '2026-04-18T12:05:00.000Z',
      created_at: '2026-04-18T12:05:00.000Z',
      updated_at: '2026-04-18T12:05:00.000Z',
    };
    const upsertMock = vi.fn((_payload: unknown, _opts: unknown) => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: updated, error: null })),
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        upsert: upsertMock,
      })),
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
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        episode_id: 'ep-1',
        marker_kind: 'blood_glucose',
        custom_name: null,
        custom_unit: null,
        value_numeric: 120,
      }),
      {
        onConflict: 'episode_id,marker_kind,custom_name_key,custom_unit_key',
      },
    );
  });

  /**
   * First time saving a line, Postgres performs an INSERT as part of ON CONFLICT upsert.
   * The client always sends one `.upsert` payload (no separate `.insert()` branch).
   */
  it('performs first save via upsert with full episode payload (insert branch inside Postgres)', async () => {
    const inserted = {
      id: 'hm-new',
      user_id: 'u1',
      episode_id: 'ep-1',
      marker_kind: 'blood_glucose',
      custom_name: null,
      custom_unit: null,
      custom_name_key: '',
      custom_unit_key: '',
      value_numeric: 88,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: 'fasting',
      recorded_at: '2026-04-18T12:00:00.000Z',
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:00.000Z',
    };
    const upsertMock = vi.fn((payload: Record<string, unknown>) => {
      expect(payload).toEqual(
        expect.objectContaining({
          user_id: 'u1',
          episode_id: 'ep-1',
          marker_kind: 'blood_glucose',
          custom_name: null,
          custom_unit: null,
          value_numeric: 88,
          systolic_numeric: null,
          diastolic_numeric: null,
          notes: 'fasting',
        }),
      );
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: inserted, error: null })),
        })),
      };
    });

    const client = {
      from: vi.fn(() => ({
        upsert: upsertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      valueNumeric: 88,
      notes: 'fasting',
      recordedAt: '2026-04-18T12:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('hm-new');
      expect(result.data.value_numeric).toBe(88);
    }
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        onConflict: 'episode_id,marker_kind,custom_name_key,custom_unit_key',
      },
    );
  });

  it('first save normalizes trimmed custom_name and custom_unit on the upsert payload', async () => {
    const customLine: PresetHealthMarkerRow = {
      ...line,
      id: 'phm-custom',
      marker_kind: 'custom',
      custom_name: '  Iron  ',
      custom_unit: '  mg  ',
    };
    const inserted = {
      id: 'hm-custom-1',
      user_id: 'u1',
      episode_id: 'ep-1',
      marker_kind: 'custom',
      custom_name: 'Iron',
      custom_unit: 'mg',
      custom_name_key: 'Iron',
      custom_unit_key: 'mg',
      value_numeric: 12,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: null,
      recorded_at: '2026-04-18T12:00:00.000Z',
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:00.000Z',
    };
    const upsertMock = vi.fn((payload: Record<string, unknown>) => {
      expect(payload).toEqual({
        user_id: 'u1',
        episode_id: 'ep-1',
        marker_kind: 'custom',
        custom_name: 'Iron',
        custom_unit: 'mg',
        value_numeric: 12,
        systolic_numeric: null,
        diastolic_numeric: null,
        notes: null,
        recorded_at: '2026-04-18T12:00:00.000Z',
      });
      return {
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: inserted, error: null })),
        })),
      };
    });
    const client = {
      from: vi.fn(() => ({
        upsert: upsertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await upsertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: customLine,
      valueNumeric: 12,
      recordedAt: '2026-04-18T12:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(upsertMock).toHaveBeenCalledTimes(1);
    expect(upsertMock).toHaveBeenCalledWith(
      expect.any(Object),
      {
        onConflict: 'episode_id,marker_kind,custom_name_key,custom_unit_key',
      },
    );
  });
});
