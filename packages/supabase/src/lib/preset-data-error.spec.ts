import { PostgrestError } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import {
  PresetDataError,
  mapSupabaseErrorToPresetDataError,
  toPresetDataError,
} from './preset-data-error.js';

describe('mapSupabaseErrorToPresetDataError', () => {
  it('maps PGRST116 to not_found', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: 'PGRST116',
      message: 'JSON object requested, multiple (or no) rows returned',
    });
    expect(mapped).toBeInstanceOf(PresetDataError);
    expect(mapped?.code).toBe('not_found');
    expect(mapped?.message).toMatch(/could not find/i);
  });

  it('maps 23505 to conflict', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: '23505',
      message: 'duplicate key value violates unique constraint',
    });
    expect(mapped?.code).toBe('conflict');
    expect(mapped?.message).toMatch(/conflict/i);
  });

  it('maps Supabase PostgrestError instances', () => {
    const pg = new PostgrestError({
      message: 'duplicate',
      details: '',
      hint: '',
      code: '23505',
    });
    const mapped = mapSupabaseErrorToPresetDataError(pg);
    expect(mapped?.code).toBe('conflict');
  });

  it('maps 23503 to foreign_key_violation', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: '23503',
      message: 'insert or update violates foreign key',
    });
    expect(mapped?.code).toBe('foreign_key_violation');
  });

  it('maps reorder RPC tokens to validation_error', () => {
    for (const fragment of [
      'abstrack_preset_reorder_count_mismatch',
      'abstrack_preset_reorder_duplicate_id',
      'abstrack_preset_reorder_unknown_line',
    ]) {
      const mapped = mapSupabaseErrorToPresetDataError({
        code: 'P0001',
        message: fragment,
      });
      expect(mapped?.code).toBe('validation_error');
      expect(mapped?.message).toMatch(/reorder/i);
    }
  });

  it('maps permission denied text to permission_denied', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: '',
      message: 'permission denied for table preset_symptoms',
    });
    expect(mapped?.code).toBe('permission_denied');
  });

  it('maps row-level security text to permission_denied', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: '',
      message: 'new row violates row-level security policy',
    });
    expect(mapped?.code).toBe('permission_denied');
  });

  it('maps 42501 to permission_denied', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: '42501',
      message: 'insufficient_privilege',
    });
    expect(mapped?.code).toBe('permission_denied');
  });

  it('maps unrecognized PostgREST-like errors to unknown', () => {
    const mapped = mapSupabaseErrorToPresetDataError({
      code: 'XX000',
      message: 'some internal failure',
    });
    expect(mapped?.code).toBe('unknown');
    expect(mapped?.message).toMatch(/try again/i);
  });

  it('returns null for non-objects', () => {
    expect(mapSupabaseErrorToPresetDataError('string')).toBeNull();
    expect(mapSupabaseErrorToPresetDataError(null)).toBeNull();
  });
});

describe('toPresetDataError', () => {
  it('wraps arbitrary Errors', () => {
    const err = toPresetDataError(new Error('boom'));
    expect(err).toBeInstanceOf(PresetDataError);
    expect(err.code).toBe('unknown');
    expect(err.message).toBe('boom');
  });

  it('falls back for non-Error values', () => {
    const err = toPresetDataError(42);
    expect(err.code).toBe('unknown');
    expect(err.message).toMatch(/try again/i);
  });
});
