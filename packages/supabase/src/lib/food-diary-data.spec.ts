import { describe, expect, it, vi } from 'vitest';
import type { FoodDiaryEntryRow } from '@abstrack/types';
import {
  createFoodDiaryEntry,
  deleteFoodDiaryEntry,
  listFoodDiaryEntriesForEpisode,
  listFoodDiaryEntriesForUser,
  normalizeFoodDiaryEntryUpdate,
  updateFoodDiaryEntry,
  validateAndNormalizeFoodDiaryCreateCore,
} from './food-diary-data.js';
import type { AbstrackSupabaseClient } from './supabase-client-type.js';

const baseRow: FoodDiaryEntryRow = {
  id: 'food-1',
  user_id: 'user-1',
  episode_id: 'ep-1',
  meal_tag: 'Breakfast',
  food_note: 'Eggs and toast',
  logged_at: '2026-04-22T10:00:00.000Z',
  created_at: '2026-04-22T10:00:00.000Z',
  updated_at: '2026-04-22T10:00:00.000Z',
};

describe('validateAndNormalizeFoodDiaryCreateCore', () => {
  it('rejects invalid meal_tag', () => {
    const r = validateAndNormalizeFoodDiaryCreateCore({
      meal_tag: 'Brunch' as never,
      food_note: 'Toast',
      logged_at: '2026-04-22T12:00:00.000Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('validation_error');
      expect(r.error.message).toContain('valid meal tag');
    }
  });

  it('rejects empty or whitespace-only food_note', () => {
    for (const food_note of ['', '   ', '\t\n']) {
      const r = validateAndNormalizeFoodDiaryCreateCore({
        meal_tag: 'Breakfast',
        food_note,
        logged_at: '2026-04-22T12:00:00.000Z',
      });
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.code).toBe('validation_error');
        expect(r.error.message).toContain('Enter what you ate');
      }
    }
  });

  it('rejects logged_at without clock or timezone (date-only)', () => {
    const r = validateAndNormalizeFoodDiaryCreateCore({
      meal_tag: 'Lunch',
      food_note: 'Salad',
      logged_at: '2026-04-22',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('valid date and time');
    }
  });

  it('rejects logged_at with local time but no Z or numeric offset', () => {
    const r = validateAndNormalizeFoodDiaryCreateCore({
      meal_tag: 'Lunch',
      food_note: 'Salad',
      logged_at: '2026-04-22T12:30',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('valid date and time');
    }
  });

  it('rejects non-existent calendar dates in logged_at', () => {
    const r = validateAndNormalizeFoodDiaryCreateCore({
      meal_tag: 'Dinner',
      food_note: 'Soup',
      logged_at: '2026-02-30T12:00:00.000Z',
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('valid date and time');
    }
  });

  it('returns normalized food_note and UTC logged_at on success', () => {
    const r = validateAndNormalizeFoodDiaryCreateCore({
      meal_tag: 'Snack',
      food_note: '  Apple  ',
      logged_at: '2026-04-22T10:05:00-04:00',
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.food_note).toBe('Apple');
      expect(r.logged_at).toBe('2026-04-22T14:05:00.000Z');
    }
  });
});

describe('normalizeFoodDiaryEntryUpdate', () => {
  it('accepts an empty patch', () => {
    const r = normalizeFoodDiaryEntryUpdate({});
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({});
    }
  });

  it('passes through keys it does not validate (e.g. episode_id)', () => {
    const r = normalizeFoodDiaryEntryUpdate({ episode_id: null });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ episode_id: null });
    }
  });

  it('rejects invalid meal_tag in patch', () => {
    const r = normalizeFoodDiaryEntryUpdate({
      meal_tag: 'TeaTime' as never,
    });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.code).toBe('validation_error');
      expect(r.error.message).toContain('valid meal tag');
    }
  });

  it('rejects blank food_note when updating note', () => {
    const r = normalizeFoodDiaryEntryUpdate({ food_note: '  \n  ' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('Enter what you ate');
    }
  });

  it('rejects invalid logged_at in patch', () => {
    const r = normalizeFoodDiaryEntryUpdate({ logged_at: 'yesterday' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('valid date and time');
    }
  });

  it('rejects date-only logged_at in patch', () => {
    const r = normalizeFoodDiaryEntryUpdate({ logged_at: '2026-05-01' });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.message).toContain('valid date and time');
    }
  });

  it('normalizes food_note and logged_at and leaves other patch fields intact', () => {
    const r = normalizeFoodDiaryEntryUpdate({
      meal_tag: 'Other',
      food_note: '  Shake  ',
      logged_at: '2026-04-22T15:15:00-05:00',
      episode_id: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({
        meal_tag: 'Other',
        food_note: 'Shake',
        logged_at: '2026-04-22T20:15:00.000Z',
        episode_id: null,
      });
    }
  });
});

describe('listFoodDiaryEntriesForUser', () => {
  it('orders by logged_at desc, created_at desc, id desc and applies default range', async () => {
    const rows: FoodDiaryEntryRow[] = [baseRow];
    const range = vi.fn(async () => ({ data: rows, error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      range,
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => orderBuilder),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listFoodDiaryEntriesForUser(client, 'user-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(rows);
    }
    expect(orderBuilder.order).toHaveBeenNthCalledWith(1, 'logged_at', {
      ascending: false,
    });
    expect(orderBuilder.order).toHaveBeenNthCalledWith(2, 'created_at', {
      ascending: false,
    });
    expect(orderBuilder.order).toHaveBeenNthCalledWith(3, 'id', {
      ascending: false,
    });
    expect(range).toHaveBeenCalledWith(0, 49);
  });

  it('returns empty rows without querying when limit is zero', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await listFoodDiaryEntriesForUser(client, 'user-1', {
      limit: 0,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([]);
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('clamps negative offset to zero before ranged query', async () => {
    const rows: FoodDiaryEntryRow[] = [baseRow];
    const range = vi.fn(async () => ({ data: rows, error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      range,
    };
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => orderBuilder),
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listFoodDiaryEntriesForUser(client, 'user-1', {
      limit: 5,
      offset: -4,
    });

    expect(result.ok).toBe(true);
    expect(range).toHaveBeenCalledWith(0, 4);
  });

  it('applies standalone-only, logged_at bounds, and non-zero offset range', async () => {
    const rows: FoodDiaryEntryRow[] = [baseRow];
    const range = vi.fn(async () => ({ data: rows, error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      range,
    };
    const lte = vi.fn(() => orderBuilder);
    const gte = vi.fn(() => ({ lte }));
    const isFn = vi.fn(() => ({ gte }));
    const eq = vi.fn(() => ({ is: isFn }));
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({ eq })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listFoodDiaryEntriesForUser(client, 'user-1', {
      standaloneOnly: true,
      loggedAtOrAfter: '2026-04-20T00:00:00.000Z',
      loggedAtOrBefore: '2026-04-20T23:59:59.999Z',
      limit: 10,
      offset: 5,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual(rows);
    }
    expect(eq).toHaveBeenCalledWith('user_id', 'user-1');
    expect(isFn).toHaveBeenCalledWith('episode_id', null);
    expect(gte).toHaveBeenCalledWith('logged_at', '2026-04-20T00:00:00.000Z');
    expect(lte).toHaveBeenCalledWith('logged_at', '2026-04-20T23:59:59.999Z');
    expect(range).toHaveBeenCalledWith(5, 14);
  });
});

describe('listFoodDiaryEntriesForEpisode', () => {
  it('filters by episode and applies explicit limit', async () => {
    const limit = vi.fn(async () => ({ data: [baseRow], error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      limit,
    };
    const eq = vi.fn(() => orderBuilder);
    const client = {
      from: vi.fn(() => ({
        select: vi.fn(() => ({
          eq,
        })),
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await listFoodDiaryEntriesForEpisode(client, 'ep-1', {
      limit: 10,
    });

    expect(result.ok).toBe(true);
    expect(eq).toHaveBeenCalledWith('episode_id', 'ep-1');
    expect(limit).toHaveBeenCalledWith(10);
  });
});

describe('createFoodDiaryEntry', () => {
  it('returns validation_error for invalid meal tag', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await createFoodDiaryEntry(client, {
      user_id: 'user-1',
      episode_id: 'ep-1',
      meal_tag: 'Brunch' as never,
      food_note: 'Toast',
      logged_at: '2026-04-22T10:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('valid meal tag');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error for blank food_note', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await createFoodDiaryEntry(client, {
      user_id: 'user-1',
      episode_id: 'ep-1',
      meal_tag: 'Lunch',
      food_note: '   ',
      logged_at: '2026-04-22T10:00:00.000Z',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('Enter what you ate');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error for invalid logged_at', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await createFoodDiaryEntry(client, {
      user_id: 'user-1',
      episode_id: 'ep-1',
      meal_tag: 'Dinner',
      food_note: 'Soup',
      logged_at: 'not-a-date',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('valid date and time');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error for date-only logged_at (no time / offset)', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await createFoodDiaryEntry(client, {
      user_id: 'user-1',
      episode_id: 'ep-1',
      meal_tag: 'Dinner',
      food_note: 'Soup',
      logged_at: '2026-04-22',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('valid date and time');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when logged_at has time but no Z or offset', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await createFoodDiaryEntry(client, {
      user_id: 'user-1',
      episode_id: 'ep-1',
      meal_tag: 'Dinner',
      food_note: 'Soup',
      logged_at: '2026-04-22T12:30',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('valid date and time');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('normalizes food_note and logged_at before insert', async () => {
    const inserted: FoodDiaryEntryRow = {
      ...baseRow,
      meal_tag: 'Snack',
      food_note: 'Apple slices',
      logged_at: '2026-04-22T14:05:00.000Z',
    };
    const insert = vi.fn((payload: Record<string, unknown>) => {
      expect(payload).toEqual(
        expect.objectContaining({
          meal_tag: 'Snack',
          food_note: 'Apple slices',
          logged_at: '2026-04-22T14:05:00.000Z',
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
        insert,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await createFoodDiaryEntry(client, {
      user_id: 'user-1',
      episode_id: 'ep-1',
      meal_tag: 'Snack',
      food_note: '  Apple slices  ',
      logged_at: '2026-04-22T10:05:00-04:00',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.food_note).toBe('Apple slices');
      expect(result.data.logged_at).toBe('2026-04-22T14:05:00.000Z');
    }
  });
});

describe('updateFoodDiaryEntry', () => {
  it('returns validation_error when meal_tag is invalid', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await updateFoodDiaryEntry(client, 'food-1', {
      meal_tag: 'Brunch' as never,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('valid meal tag');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when food_note is blank', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await updateFoodDiaryEntry(client, 'food-1', {
      food_note: '   ',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('Enter what you ate');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('returns validation_error when logged_at is invalid', async () => {
    const client = {
      from: vi.fn(() => {
        throw new Error('should not query');
      }),
    } as unknown as AbstrackSupabaseClient;

    const result = await updateFoodDiaryEntry(client, 'food-1', {
      logged_at: 'bad-value',
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('validation_error');
      expect(result.error.message).toContain('valid date and time');
    }
    expect(client.from).not.toHaveBeenCalled();
  });

  it('normalizes update patch before writing', async () => {
    const updated: FoodDiaryEntryRow = {
      ...baseRow,
      meal_tag: 'Other',
      food_note: 'Protein shake',
      logged_at: '2026-04-22T20:15:00.000Z',
    };
    const update = vi.fn((patch: Record<string, unknown>) => {
      expect(patch).toEqual({
        meal_tag: 'Other',
        food_note: 'Protein shake',
        logged_at: '2026-04-22T20:15:00.000Z',
      });
      return {
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            single: vi.fn(async () => ({ data: updated, error: null })),
          })),
        })),
      };
    });
    const client = {
      from: vi.fn(() => ({
        update,
      })),
    } as unknown as AbstrackSupabaseClient;

    const result = await updateFoodDiaryEntry(client, 'food-1', {
      meal_tag: 'Other',
      food_note: '  Protein shake  ',
      logged_at: '2026-04-22T15:15:00-05:00',
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.food_note).toBe('Protein shake');
      expect(result.data.logged_at).toBe('2026-04-22T20:15:00.000Z');
    }
    expect(client.from).toHaveBeenCalledWith('food_diary_entries');
  });
});

describe('deleteFoodDiaryEntry', () => {
  it('returns true when a row was deleted', async () => {
    const maybeSingle = vi.fn(async () => ({
      data: { id: 'food-1' },
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

    const result = await deleteFoodDiaryEntry(client, 'food-1');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(true);
    }
  });

  it('returns false when no row matched', async () => {
    const maybeSingle = vi.fn(async () => ({ data: null, error: null }));
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

    const result = await deleteFoodDiaryEntry(client, 'food-missing');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe(false);
    }
  });
});
