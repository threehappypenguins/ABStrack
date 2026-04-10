import { describe, expect, it, vi } from 'vitest';
import type { PresetSymptomRow } from '@abstrack/types';
import {
  reorderPresetSymptoms,
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
