import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import { CrudBatch, CrudEntry, UpdateType } from '@powersync/react-native';

import {
  applyPowerSyncCrudEntryToSupabase,
  normalizePowerSyncRowForSupabase,
  uploadPowerSyncCrudBatchToSupabase,
} from './powersync-supabase-upload';

type TableOp =
  | {
      kind: 'upsert';
      table: string;
      payload: unknown;
      options: unknown;
    }
  | { kind: 'patch'; table: string; patch: unknown; id: string }
  | { kind: 'delete'; table: string; id: string };

/**
 * Minimal PostgREST-style chain that records which write shape ran (upsert / update+eq+select /
 * delete+eq+select), matching {@link applyPowerSyncCrudEntryToSupabase}.
 */
function createSupabaseUploadMock(): {
  client: AbstrackSupabaseClient;
  ops: TableOp[];
} {
  const ops: TableOp[] = [];
  const client = {
    from(table: string) {
      return {
        upsert(payload: unknown, options: unknown) {
          ops.push({ kind: 'upsert', table, payload, options });
          return Promise.resolve({ error: null });
        },
        update(patch: unknown) {
          return {
            eq(column: string, value: unknown) {
              ops.push({
                kind: 'patch',
                table,
                patch,
                id: String(value),
              });
              return {
                select(_columns: string) {
                  return {
                    single() {
                      return Promise.resolve({ error: null });
                    },
                  };
                },
              };
            },
          };
        },
        delete() {
          return {
            eq(column: string, value: unknown) {
              ops.push({ kind: 'delete', table, id: String(value) });
              return {
                select(_columns: string) {
                  return {
                    single() {
                      return Promise.resolve({ error: null });
                    },
                  };
                },
              };
            },
          };
        },
      };
    },
  } as unknown as AbstrackSupabaseClient;
  return { client, ops };
}

describe('normalizePowerSyncRowForSupabase', () => {
  it('converts episode_symptoms.response_boolean 0/1 from SQLite integers to booleans', () => {
    expect(
      normalizePowerSyncRowForSupabase('episode_symptoms', {
        response_boolean: 1,
      }).response_boolean,
    ).toBe(true);
    expect(
      normalizePowerSyncRowForSupabase('episode_symptoms', {
        response_boolean: 0,
      }).response_boolean,
    ).toBe(false);
  });

  it('leaves episode_symptoms.response_boolean unchanged when not 0 or 1', () => {
    const row = { response_boolean: true };
    expect(normalizePowerSyncRowForSupabase('episode_symptoms', row)).toEqual(
      row,
    );
  });

  it('does not touch response_boolean on other tables', () => {
    expect(
      normalizePowerSyncRowForSupabase('episodes', { response_boolean: 1 }),
    ).toEqual({ response_boolean: 1 });
  });
});

describe('applyPowerSyncCrudEntryToSupabase', () => {
  it('PUT merges id into opData, normalizes, and upserts with onConflict id', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const entry = new CrudEntry(
      1,
      UpdateType.PUT,
      'episodes',
      'e1',
      undefined,
      { started_at: '2020-01-01T00:00:00.000Z' },
    );
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    expect(ops).toEqual([
      {
        kind: 'upsert',
        table: 'episodes',
        payload: {
          started_at: '2020-01-01T00:00:00.000Z',
          id: 'e1',
        },
        options: { onConflict: 'id' },
      },
    ]);
  });

  it('PUT normalizes episode_symptoms booleans before upsert', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const entry = new CrudEntry(
      2,
      UpdateType.PUT,
      'episode_symptoms',
      's1',
      undefined,
      { response_boolean: 0, episode_id: 'e1' },
    );
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    expect(ops[0]).toMatchObject({
      kind: 'upsert',
      table: 'episode_symptoms',
      payload: {
        id: 's1',
        episode_id: 'e1',
        response_boolean: false,
      },
      options: { onConflict: 'id' },
    });
  });

  it('PATCH sends normalized opData with update eq id and select id single', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const entry = new CrudEntry(
      3,
      UpdateType.PATCH,
      'episodes',
      'e2',
      undefined,
      { ended_at: '2020-02-02T00:00:00.000Z' },
    );
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    expect(ops).toEqual([
      {
        kind: 'patch',
        table: 'episodes',
        patch: { ended_at: '2020-02-02T00:00:00.000Z' },
        id: 'e2',
      },
    ]);
  });

  it('DELETE uses delete eq id and select id single', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const entry = new CrudEntry(4, UpdateType.DELETE, 'episodes', 'e3');
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    expect(ops).toEqual([{ kind: 'delete', table: 'episodes', id: 'e3' }]);
  });

  it('rejects when upsert returns PostgREST error', async () => {
    const upsert = jest
      .fn()
      .mockResolvedValue({ error: { message: 'row-level security' } });
    const client = {
      from: jest.fn(() => ({ upsert })),
    } as unknown as AbstrackSupabaseClient;
    const entry = new CrudEntry(
      5,
      UpdateType.PUT,
      'episodes',
      'e4',
      undefined,
      {
        started_at: 'x',
      },
    );
    await expect(
      applyPowerSyncCrudEntryToSupabase(client, entry),
    ).rejects.toEqual({ message: 'row-level security' });
  });
});

describe('uploadPowerSyncCrudBatchToSupabase', () => {
  it('applies each CRUD entry in order then completes the batch', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const complete = jest.fn().mockResolvedValue(undefined);
    const batch = new CrudBatch(
      [
        new CrudEntry(1, UpdateType.PUT, 'episodes', 'a', undefined, {
          started_at: '1',
        }),
        new CrudEntry(2, UpdateType.PATCH, 'episodes', 'a', undefined, {
          ended_at: '2',
        }),
      ],
      false,
      complete,
    );
    await uploadPowerSyncCrudBatchToSupabase(client, batch);
    expect(ops.map((o) => o.kind)).toEqual(['upsert', 'patch']);
    expect(complete).toHaveBeenCalledTimes(1);
  });
});
