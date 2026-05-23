import { describe, expect, it, vi } from 'vitest';
import {
  ensurePatientProfileRow,
  ensureProfileRow,
  isPostgresUniqueViolation,
} from './ensure-patient-profile.js';

describe('isPostgresUniqueViolation', () => {
  it('detects code 23505', () => {
    expect(isPostgresUniqueViolation({ code: '23505' })).toBe(true);
    expect(isPostgresUniqueViolation({ code: '42501' })).toBe(false);
  });
});

describe('ensurePatientProfileRow', () => {
  it('returns ok when profile already exists', async () => {
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: { id: 'u1' }, error: null }),
          }),
        }),
      }),
    } as never;

    await expect(ensurePatientProfileRow(client, 'u1')).resolves.toEqual({
      ok: true,
    });
  });

  it('inserts patient profile when absent', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert,
      }),
    } as never;

    const result = await ensurePatientProfileRow(client, 'u1');
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({ id: 'u1', app_role: 'patient' });
  });
});

describe('ensureProfileRow', () => {
  it('inserts caretaker profile when absent', async () => {
    const insert = vi.fn(async () => ({ error: null }));
    const client = {
      from: () => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
        insert,
      }),
    } as never;

    const result = await ensureProfileRow(client, 'u1', 'caretaker');
    expect(result).toEqual({ ok: true });
    expect(insert).toHaveBeenCalledWith({ id: 'u1', app_role: 'caretaker' });
  });
});
