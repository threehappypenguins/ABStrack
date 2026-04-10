import { describe, expect, it, vi } from 'vitest';
import type {
  HealthMarkerPresetRow,
  PresetSymptomRow,
  SymptomPresetRow,
} from '@abstrack/types';
import {
  createHealthMarkerPreset,
  createPresetSymptom,
  createSymptomPreset,
  deleteSymptomPreset,
  getSymptomPresetById,
  listHealthMarkerPresets,
  listPresetSymptomsForPreset,
  listSymptomPresets,
  reorderPresetHealthMarkers,
  reorderPresetSymptoms,
  updateSymptomPreset,
  validateReorderLineIds,
} from './preset-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

describe('validateReorderLineIds', () => {
  const existing = ['a', 'b', 'c'] as const;

  it('accepts a full permutation in order', () => {
    expect(validateReorderLineIds(existing, ['c', 'a', 'b'])).toBeNull();
  });

  it('rejects wrong length', () => {
    const err = validateReorderLineIds(existing, ['a', 'b']);
    expect(err?.code).toBe('validation_error');
    expect(err?.message).toMatch(/every line/i);
  });

  it('rejects unknown ids', () => {
    const err = validateReorderLineIds(existing, ['a', 'b', 'x']);
    expect(err?.code).toBe('validation_error');
    expect(err?.message).toMatch(/not part of this preset/i);
  });

  it('rejects duplicate ids', () => {
    const err = validateReorderLineIds(existing, ['a', 'a', 'b']);
    expect(err?.code).toBe('validation_error');
    expect(err?.message).toMatch(/once/i);
  });

  it('accepts empty preset and empty order', () => {
    expect(validateReorderLineIds([], [])).toBeNull();
  });
});

describe('preset CRUD helpers (mocked client)', () => {
  const symptomPresetRow: SymptomPresetRow = {
    id: 'sp-1',
    user_id: 'user-1',
    name: 'Morning',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  const healthMarkerPresetRow: HealthMarkerPresetRow = {
    id: 'hmp-1',
    user_id: 'user-1',
    name: 'Default',
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };

  it('listSymptomPresets returns rows from ordered select', async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(async () => ({
            data: [symptomPresetRow],
            error: null,
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await listSymptomPresets(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([symptomPresetRow]);
    }
    expect(from).toHaveBeenCalledWith('symptom_presets');
  });

  it('getSymptomPresetById returns row when maybeSingle succeeds', async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(async () => ({
            data: symptomPresetRow,
            error: null,
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await getSymptomPresetById(client, 'sp-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(symptomPresetRow);
    }
  });

  it('createSymptomPreset returns inserted row', async () => {
    const from = vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: symptomPresetRow,
            error: null,
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await createSymptomPreset(client, {
      user_id: 'user-1',
      name: 'Morning',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('sp-1');
    }
  });

  it('updateSymptomPreset maps PostgREST unique violation to conflict', async () => {
    const from = vi.fn(() => ({
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({
              data: null,
              error: {
                code: '23505',
                message: 'duplicate key value violates unique constraint',
              },
            })),
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await updateSymptomPreset(client, 'sp-1', { name: 'X' });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('conflict');
    }
  });

  it('listPresetSymptomsForPreset returns lines for preset_id', async () => {
    const line: PresetSymptomRow = {
      id: 'ps-1',
      preset_id: 'sp-1',
      sort_order: 0,
      symptom_name: 'Fatigue',
      response_type: 'yes_no',
      prompt_instruction: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(async () => ({ data: [line], error: null })),
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await listPresetSymptomsForPreset(client, 'sp-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([line]);
    }
    expect(from).toHaveBeenCalledWith('preset_symptoms');
  });

  it('createPresetSymptom returns inserted line', async () => {
    const line: PresetSymptomRow = {
      id: 'ps-new',
      preset_id: 'sp-1',
      sort_order: 0,
      symptom_name: 'Nausea',
      response_type: 'free_text',
      prompt_instruction: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };
    const from = vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({ data: line, error: null })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await createPresetSymptom(client, {
      preset_id: 'sp-1',
      sort_order: 0,
      symptom_name: 'Nausea',
      response_type: 'free_text',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('ps-new');
    }
  });

  it('listHealthMarkerPresets returns rows', async () => {
    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        order: vi.fn(() => ({
          order: vi.fn(async () => ({
            data: [healthMarkerPresetRow],
            error: null,
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await listHealthMarkerPresets(client);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([healthMarkerPresetRow]);
    }
    expect(from).toHaveBeenCalledWith('health_marker_presets');
  });

  it('createHealthMarkerPreset returns inserted row', async () => {
    const from = vi.fn(() => ({
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          single: vi.fn(async () => ({
            data: healthMarkerPresetRow,
            error: null,
          })),
        })),
      })),
    }));
    const client = { from } as unknown as AbstrackSupabaseClient;

    const result = await createHealthMarkerPreset(client, {
      user_id: 'user-1',
      name: 'Default',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.id).toBe('hmp-1');
    }
  });
});

describe('reorderPresetSymptoms', () => {
  it('calls reorder RPC with validated ids after listing lines', async () => {
    const rows: PresetSymptomRow[] = [
      {
        id: 'line-1',
        preset_id: 'preset-1',
        sort_order: 0,
        symptom_name: 'x',
        response_type: 'yes_no',
        prompt_instruction: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'line-2',
        preset_id: 'preset-1',
        sort_order: 1,
        symptom_name: 'y',
        response_type: 'free_text',
        prompt_instruction: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const rpc = vi.fn(async () => ({ data: null, error: null }));

    const from = vi.fn((table: string) => {
      if (table !== 'preset_symptoms') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(async () => ({ data: rows, error: null })),
            })),
          })),
        })),
      };
    });

    const client = { from, rpc } as unknown as AbstrackSupabaseClient;

    const result = await reorderPresetSymptoms(client, 'preset-1', [
      'line-2',
      'line-1',
    ]);

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reorder_preset_symptoms', {
      p_preset_id: 'preset-1',
      p_ordered_ids: ['line-2', 'line-1'],
    });
  });

  it('returns validation_error without calling RPC when order is invalid', async () => {
    const rows: PresetSymptomRow[] = [
      {
        id: 'line-1',
        preset_id: 'preset-1',
        sort_order: 0,
        symptom_name: 'x',
        response_type: 'yes_no',
        prompt_instruction: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const rpc = vi.fn();

    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      })),
    }));

    const client = { from, rpc } as unknown as AbstrackSupabaseClient;

    const result = await reorderPresetSymptoms(client, 'preset-1', []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('reorderPresetHealthMarkers', () => {
  it('calls reorder RPC with validated ids after listing lines', async () => {
    const rows: PresetHealthMarkerRow[] = [
      {
        id: 'hm-1',
        preset_id: 'preset-hm-1',
        sort_order: 0,
        marker_kind: 'weight',
        custom_name: null,
        custom_unit: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 'hm-2',
        preset_id: 'preset-hm-1',
        sort_order: 1,
        marker_kind: 'bac',
        custom_name: null,
        custom_unit: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const rpc = vi.fn(async () => ({ data: null, error: null }));

    const from = vi.fn((table: string) => {
      if (table !== 'preset_health_markers') {
        throw new Error(`unexpected table ${table}`);
      }
      return {
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            order: vi.fn(() => ({
              order: vi.fn(async () => ({ data: rows, error: null })),
            })),
          })),
        })),
      };
    });

    const client = { from, rpc } as unknown as AbstrackSupabaseClient;

    const result = await reorderPresetHealthMarkers(client, 'preset-hm-1', [
      'hm-2',
      'hm-1',
    ]);

    expect(result.ok).toBe(true);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith('reorder_preset_health_markers', {
      p_preset_id: 'preset-hm-1',
      p_ordered_ids: ['hm-2', 'hm-1'],
    });
  });

  it('returns validation_error without calling RPC when order is invalid', async () => {
    const rows: PresetHealthMarkerRow[] = [
      {
        id: 'hm-1',
        preset_id: 'preset-hm-1',
        sort_order: 0,
        marker_kind: 'heart_rate',
        custom_name: null,
        custom_unit: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    ];

    const rpc = vi.fn();

    const from = vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          order: vi.fn(() => ({
            order: vi.fn(async () => ({ data: rows, error: null })),
          })),
        })),
      })),
    }));

    const client = { from, rpc } as unknown as AbstrackSupabaseClient;

    const result = await reorderPresetHealthMarkers(client, 'preset-hm-1', []);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe('deleteSymptomPreset', () => {
  function mockDeleteChain(result: {
    data: { id: string } | null;
    error: { code: string; message: string } | null;
  }) {
    const single = vi.fn(async () => result);
    return {
      from: vi.fn(() => ({
        delete: vi.fn(() => ({
          eq: vi.fn(() => ({
            select: vi.fn(() => ({
              single,
            })),
          })),
        })),
      })),
    };
  }

  it('returns ok when one row is deleted (returning representation)', async () => {
    const client = mockDeleteChain({
      data: { id: 'preset-a' },
      error: null,
    }) as unknown as AbstrackSupabaseClient;

    const result = await deleteSymptomPreset(client, 'preset-a');

    expect(result.ok).toBe(true);
  });

  it('returns not_found when delete matches 0 rows', async () => {
    const client = mockDeleteChain({
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
      },
    }) as unknown as AbstrackSupabaseClient;

    const result = await deleteSymptomPreset(client, 'missing-id');

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('not_found');
    }
  });
});
