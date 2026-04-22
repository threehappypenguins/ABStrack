import { describe, expect, it, vi } from 'vitest';
import type { FoodDiaryEntryRow } from '@abstrack/types';
import {
  createFoodDiaryEntry,
  deleteFoodDiaryEntry,
  listFoodDiaryEntriesForEpisode,
  listFoodDiaryEntriesForUser,
  updateFoodDiaryEntry,
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

describe('listFoodDiaryEntriesForUser', () => {
  it('orders by logged_at desc, created_at desc, id desc and applies default limit', async () => {
    const rows: FoodDiaryEntryRow[] = [baseRow];
    const limit = vi.fn(async () => ({ data: rows, error: null }));
    const orderBuilder = {
      order: vi.fn(() => orderBuilder),
      limit,
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
    expect(limit).toHaveBeenCalledWith(50);
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
