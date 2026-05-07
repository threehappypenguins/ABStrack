import { describe, expect, it, vi } from 'vitest';
import type { PresetHealthMarkerRow } from '@abstrack/types';
import {
  buildHealthMarkerInsertRowForPresetLine,
  createStandaloneHealthMarkerForLine,
  deleteHealthMarkerById,
  listEpisodeHealthMarkersForEpisode,
  listStandaloneHealthMarkersForUser,
  insertEpisodeHealthMarkerForLine,
  validateHealthMarkerNumericPayload,
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

describe('validateHealthMarkerNumericPayload', () => {
  describe('blood_pressure', () => {
    it('rejects value_numeric (must use systolic/diastolic)', () => {
      expect(
        validateHealthMarkerNumericPayload('blood_pressure', 120, 118, 76),
      ).toContain('single number');
    });

    it('rejects missing systolic or diastolic', () => {
      expect(
        validateHealthMarkerNumericPayload(
          'blood_pressure',
          null,
          120,
          undefined,
        ),
      ).toContain('systolic and diastolic');
      expect(
        validateHealthMarkerNumericPayload(
          'blood_pressure',
          null,
          undefined,
          80,
        ),
      ).toContain('systolic and diastolic');
    });

    it('rejects non-finite systolic or diastolic', () => {
      expect(
        validateHealthMarkerNumericPayload(
          'blood_pressure',
          null,
          Number.NaN,
          80,
        ),
      ).toContain('valid numbers');
      expect(
        validateHealthMarkerNumericPayload(
          'blood_pressure',
          null,
          120,
          Number.POSITIVE_INFINITY,
        ),
      ).toContain('valid numbers');
    });

    it('returns null when systolic and diastolic are finite', () => {
      expect(
        validateHealthMarkerNumericPayload('blood_pressure', null, 118, 76),
      ).toBeNull();
    });
  });

  describe('non-blood_pressure kinds', () => {
    it('rejects missing value_numeric', () => {
      expect(
        validateHealthMarkerNumericPayload('blood_glucose', null, null, null),
      ).toContain('measurement value');
    });

    it('rejects non-finite value_numeric', () => {
      expect(
        validateHealthMarkerNumericPayload(
          'blood_glucose',
          Number.NaN,
          null,
          null,
        ),
      ).toContain('valid number');
      expect(
        validateHealthMarkerNumericPayload(
          'heart_rate',
          Number.NEGATIVE_INFINITY,
          null,
          null,
        ),
      ).toContain('valid number');
    });

    it('rejects systolic/diastolic fields for single-value kinds', () => {
      expect(
        validateHealthMarkerNumericPayload('blood_glucose', 120, 120, null),
      ).toContain('single numeric value');
      expect(
        validateHealthMarkerNumericPayload('blood_glucose', 120, null, 80),
      ).toContain('single numeric value');
    });

    it('accepts zero as a finite measurement', () => {
      expect(
        validateHealthMarkerNumericPayload('blood_glucose', 0, null, null),
      ).toBeNull();
    });
  });
});

describe('buildHealthMarkerInsertRowForPresetLine', () => {
  const recordedAt = '2026-04-18T12:00:00.000Z';

  it('maps episode-bound glucose: value_numeric only, BP columns null', () => {
    const row = buildHealthMarkerInsertRowForPresetLine({
      userId: 'user-1',
      episodeId: 'ep-42',
      line,
      customName: null,
      customUnit: null,
      valueNumeric: 6.2,
      systolicNumeric: null,
      diastolicNumeric: null,
      notes: 'post-meal',
      recordedAt,
    });
    expect(row).toEqual({
      user_id: 'user-1',
      episode_id: 'ep-42',
      preset_health_marker_id: 'phm-1',
      marker_kind: 'blood_glucose',
      custom_name: null,
      custom_unit: null,
      value_numeric: 6.2,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: 'post-meal',
      recorded_at: recordedAt,
    });
  });

  it('clears systolic/diastolic for non-blood_pressure kinds even when callers pass them', () => {
    const row = buildHealthMarkerInsertRowForPresetLine({
      userId: 'user-1',
      episodeId: 'ep-42',
      line,
      customName: 'Glucose',
      customUnit: 'mmol/L',
      valueNumeric: 5,
      systolicNumeric: 120,
      diastolicNumeric: 80,
      notes: null,
      recordedAt,
    });
    expect(row.systolic_numeric).toBeNull();
    expect(row.diastolic_numeric).toBeNull();
    expect(row.value_numeric).toBe(5);
  });

  it('maps blood_pressure: null value_numeric, preserves systolic/diastolic', () => {
    const bpLine: PresetHealthMarkerRow = {
      ...line,
      marker_kind: 'blood_pressure',
    };
    const row = buildHealthMarkerInsertRowForPresetLine({
      userId: 'user-1',
      episodeId: 'ep-42',
      line: bpLine,
      customName: null,
      customUnit: null,
      valueNumeric: 999,
      systolicNumeric: 122,
      diastolicNumeric: 78,
      notes: null,
      recordedAt,
    });
    expect(row.marker_kind).toBe('blood_pressure');
    expect(row.value_numeric).toBeNull();
    expect(row.systolic_numeric).toBe(122);
    expect(row.diastolic_numeric).toBe(78);
  });

  it('sets episode_id null for standalone inserts', () => {
    const row = buildHealthMarkerInsertRowForPresetLine({
      userId: 'user-1',
      episodeId: null,
      line,
      customName: null,
      customUnit: null,
      valueNumeric: 100,
      systolicNumeric: null,
      diastolicNumeric: null,
      notes: 'home',
      recordedAt,
    });
    expect(row.episode_id).toBeNull();
    expect(row.user_id).toBe('user-1');
    expect(row.value_numeric).toBe(100);
  });
});

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

describe('insertEpisodeHealthMarkerForLine', () => {
  it('returns validation_error when non-blood_pressure line omits valueNumeric', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('measurement value');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when non-blood_pressure valueNumeric is not finite', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const nanResult = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      valueNumeric: Number.NaN,
    });
    expect(nanResult.ok).toBe(false);
    if (!nanResult.ok) {
      expect(nanResult.error.message).toContain('valid number');
    }

    const infResult = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      valueNumeric: Number.POSITIVE_INFINITY,
    });
    expect(infResult.ok).toBe(false);
    if (!infResult.ok) {
      expect(infResult.error.message).toContain('valid number');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when blood_glucose line includes blood pressure fields', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      valueNumeric: 120,
      systolicNumeric: 120,
      diastolicNumeric: 80,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('single numeric value');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when blood_pressure line uses valueNumeric', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: { ...line, marker_kind: 'blood_pressure' },
      valueNumeric: 120,
      systolicNumeric: 120,
      diastolicNumeric: 80,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('single number');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when blood_pressure line is missing diastolic', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: { ...line, marker_kind: 'blood_pressure' },
      systolicNumeric: 120,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('systolic and diastolic');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('inserts blood_pressure with systolic/diastolic and null value_numeric', async () => {
    const bpLine: PresetHealthMarkerRow = {
      ...line,
      marker_kind: 'blood_pressure',
    };
    const updated = {
      id: 'hm-bp',
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_health_marker_id: 'phm-1',
      marker_kind: 'blood_pressure',
      custom_name: null,
      custom_unit: null,
      custom_name_key: '',
      custom_unit_key: '',
      value_numeric: null,
      systolic_numeric: 118,
      diastolic_numeric: 76,
      notes: null,
      recorded_at: '2026-04-18T12:05:00.000Z',
      created_at: '2026-04-18T12:05:00.000Z',
      updated_at: '2026-04-18T12:05:00.000Z',
    };
    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: updated, error: null })),
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        insert: insertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: bpLine,
      systolicNumeric: 118,
      diastolicNumeric: 76,
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        marker_kind: 'blood_pressure',
        value_numeric: null,
        systolic_numeric: 118,
        diastolic_numeric: 76,
      }),
    );
  });

  it('returns validation_error when custom line is missing fields', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
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

  it('inserts a new row for each save (no upsert)', async () => {
    const newId = 'hm-existing';
    const updated = {
      id: newId,
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_health_marker_id: 'phm-1',
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
    const insertMock = vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(async () => ({ data: updated, error: null })),
      })),
    }));
    const client = {
      from: vi.fn(() => ({
        insert: insertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line,
      valueNumeric: 120,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe(newId);
      expect(result.data.value_numeric).toBe(120);
    }
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock).toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: 'u1',
        episode_id: 'ep-1',
        preset_health_marker_id: 'phm-1',
        marker_kind: 'blood_glucose',
        custom_name: null,
        custom_unit: null,
        value_numeric: 120,
      }),
    );
  });

  it('inserts a row with the full episode payload', async () => {
    const inserted = {
      id: 'hm-new',
      user_id: 'u1',
      episode_id: 'ep-1',
      preset_health_marker_id: 'phm-1',
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
    const insertMock = vi.fn((payload: Record<string, unknown>) => {
      expect(payload).toEqual(
        expect.objectContaining({
          user_id: 'u1',
          episode_id: 'ep-1',
          preset_health_marker_id: 'phm-1',
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
        insert: insertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
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
    expect(insertMock).toHaveBeenCalledTimes(1);
  });

  it('first save normalizes trimmed custom_name and custom_unit on the insert payload', async () => {
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
      preset_health_marker_id: 'phm-custom',
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
    const insertMock = vi.fn((payload: Record<string, unknown>) => {
      expect(payload).toEqual({
        user_id: 'u1',
        episode_id: 'ep-1',
        preset_health_marker_id: 'phm-custom',
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
        insert: insertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await insertEpisodeHealthMarkerForLine(client, {
      userId: 'u1',
      episodeId: 'ep-1',
      line: customLine,
      valueNumeric: 12,
      recordedAt: '2026-04-18T12:00:00.000Z',
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
  });
});

describe('createStandaloneHealthMarkerForLine', () => {
  it('inserts a standalone marker with episode_id null', async () => {
    const inserted = {
      id: 'hm-standalone-1',
      user_id: 'u1',
      episode_id: null,
      preset_health_marker_id: 'phm-1',
      marker_kind: 'blood_glucose',
      custom_name: null,
      custom_unit: null,
      custom_name_key: '',
      custom_unit_key: '',
      value_numeric: 101,
      systolic_numeric: null,
      diastolic_numeric: null,
      notes: 'daily check',
      recorded_at: '2026-04-18T12:00:00.000Z',
      created_at: '2026-04-18T12:00:00.000Z',
      updated_at: '2026-04-18T12:00:00.000Z',
    };
    const singleMock = vi.fn(async () => ({ data: inserted, error: null }));
    const selectMock = vi.fn(() => ({ single: singleMock }));
    const insertMock = vi.fn((payload: Record<string, unknown>) => {
      expect(payload).toEqual(
        expect.objectContaining({
          user_id: 'u1',
          episode_id: null,
          preset_health_marker_id: 'phm-1',
          marker_kind: 'blood_glucose',
          value_numeric: 101,
          notes: 'daily check',
          recorded_at: '2026-04-18T12:00:00.000Z',
        }),
      );
      return {
        select: selectMock,
      };
    });
    const client = {
      from: vi.fn(() => ({
        insert: insertMock,
      })),
    } as unknown as AbstrackSupabaseClient;

    const recordedAt = '2026-04-18T12:00:00.000Z';
    const result = await createStandaloneHealthMarkerForLine(client, {
      userId: 'u1',
      line,
      valueNumeric: 101,
      notes: 'daily check',
      recordedAt,
    });

    expect(result.ok).toBe(true);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledTimes(1);
    expect(selectMock).toHaveBeenCalledWith('*');
    expect(singleMock).toHaveBeenCalledTimes(1);
    if (result.ok) {
      expect(result.data).toEqual(inserted);
    }
  });
});

describe('listStandaloneHealthMarkersForUser', () => {
  it('filters episode_id null, orders, and ranges', async () => {
    const rows = [{ id: 'hm-1' }];
    const range = vi.fn(async () => ({ data: rows, error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      range,
    };
    const isFn = vi.fn(() => orderBuilder);
    const eq = vi.fn(() => ({ is: isFn }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listStandaloneHealthMarkersForUser(client, 'u1', {
      limit: 10,
      offset: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(rows);
    }
    expect(eq).toHaveBeenCalledWith('user_id', 'u1');
    expect(isFn).toHaveBeenCalledWith('episode_id', null);
    expect(range).toHaveBeenCalledWith(5, 14);
  });

  it('returns empty rows without querying when limit is zero', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await listStandaloneHealthMarkersForUser(client, 'u1', {
      limit: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('clamps negative offset to zero before ranged query', async () => {
    const rows = [{ id: 'hm-1' }];
    const range = vi.fn(async () => ({ data: rows, error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      range,
    };
    const isFn = vi.fn(() => orderBuilder);
    const eq = vi.fn(() => ({ is: isFn }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listStandaloneHealthMarkersForUser(client, 'u1', {
      limit: 5,
      offset: -4,
    });

    expect(result.ok).toBe(true);
    expect(range).toHaveBeenCalledWith(0, 4);
  });

  it('applies recorded_at bounds when provided', async () => {
    const rows = [{ id: 'hm-1' }];
    const range = vi.fn(async () => ({ data: rows, error: null }));
    const gte = vi.fn();
    const lte = vi.fn();
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      range,
      gte: vi.fn((...args: unknown[]) => {
        gte(...args);
        return orderBuilder;
      }),
      lte: vi.fn((...args: unknown[]) => {
        lte(...args);
        return orderBuilder;
      }),
    };
    const isFn = vi.fn(() => orderBuilder);
    const eq = vi.fn(() => ({ is: isFn }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listStandaloneHealthMarkersForUser(client, 'u1', {
      limit: 10,
      offset: 5,
      recordedAtOrAfter: '2026-04-20T00:00:00.000Z',
      recordedAtOrBefore: '2026-04-20T23:59:59.999Z',
    });

    expect(result.ok).toBe(true);
    expect(gte).toHaveBeenCalledWith('recorded_at', '2026-04-20T00:00:00.000Z');
    expect(lte).toHaveBeenCalledWith('recorded_at', '2026-04-20T23:59:59.999Z');
    expect(range).toHaveBeenCalledWith(5, 14);
  });
});

describe('deleteHealthMarkerById', () => {
  it('returns true when a row is deleted', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: 'hm-1' },
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

    const result = await deleteHealthMarkerById(client, 'hm-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(true);
    }
  });
});
