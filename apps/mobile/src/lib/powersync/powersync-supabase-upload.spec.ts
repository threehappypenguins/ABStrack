import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import {
  listEpisodeMediaBucketPathsForEpisodeMediaId,
  listEpisodeMediaBucketPathsForEpisodeSymptomId,
  PresetDataError,
  removeEpisodeMediaStorageObjectPathsWithResult,
} from '@abstrack/supabase';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';
import { CrudBatch, CrudEntry, UpdateType } from '@powersync/react-native';

import {
  applyPowerSyncCrudEntryToSupabase,
  drainPendingEpisodeMediaStorageCleanupQueue,
  normalizePowerSyncRowForSupabase,
  POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON,
  POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE,
  uploadPowerSyncCrudBatchToSupabase,
} from './powersync-supabase-upload';

jest.mock('@abstrack/supabase', () => ({
  ...jest.requireActual<typeof import('@abstrack/supabase')>(
    '@abstrack/supabase',
  ),
  listEpisodeMediaBucketPathsForEpisodeSymptomId: jest.fn(),
  listEpisodeMediaBucketPathsForEpisodeMediaId: jest.fn(),
  removeEpisodeMediaStorageObjectPathsWithResult: jest.fn(),
}));

const mockListEpisodeMediaBucketPathsForEpisodeSymptomId = jest.mocked(
  listEpisodeMediaBucketPathsForEpisodeSymptomId,
);
const mockListEpisodeMediaBucketPathsForEpisodeMediaId = jest.mocked(
  listEpisodeMediaBucketPathsForEpisodeMediaId,
);
const mockRemoveEpisodeMediaStorageObjectPathsWithResult = jest.mocked(
  removeEpisodeMediaStorageObjectPathsWithResult,
);

const mobilePackageJsonPath = join(__dirname, '../../../package.json');

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
 *
 * `update().eq().select().maybeSingle()` and `delete().eq().select().maybeSingle()` resolve with the
 * same **`{ data, error }`** shape as supabase-js: success with one row → `data: { id }`, success
 * with zero rows → `data: null` (no PGRST116), failure → `error` set and `data` null. Use
 * `zeroRowDeleteForTable` on this factory to force the zero-row delete path for Storage-guard tests.
 */
function createSupabaseUploadMock(options?: {
  /** When set, `delete().eq().select().maybeSingle()` resolves with this PostgREST error for that table. */
  deleteErrorForTable?: Partial<Record<string, unknown>>;
  /**
   * When true for a table, simulates PostgREST DELETE success with **0 rows** (`data: null`, `error: null`)
   * — same as RLS hiding the row or idempotent replay after the row is already gone.
   */
  zeroRowDeleteForTable?: Partial<Record<string, boolean>>;
}): {
  client: AbstrackSupabaseClient;
  ops: TableOp[];
} {
  const ops: TableOp[] = [];
  const deleteErrorForTable = options?.deleteErrorForTable ?? {};
  const zeroRowDeleteForTable = options?.zeroRowDeleteForTable ?? {};
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
                    maybeSingle() {
                      return Promise.resolve({
                        data: { id: String(value) },
                        error: null,
                      });
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
              const err = deleteErrorForTable[table] ?? null;
              const zeroRow = zeroRowDeleteForTable[table] === true;
              return {
                select(_columns: string) {
                  return {
                    maybeSingle() {
                      if (zeroRow) {
                        return Promise.resolve({ data: null, error: null });
                      }
                      return Promise.resolve({
                        data: err != null ? null : { id: String(value) },
                        error: err,
                      });
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

describe('PowerSync upload runtime contract', () => {
  it('keeps upload pins aligned with apps/mobile/package.json @powersync/* versions', () => {
    const pkg = JSON.parse(readFileSync(mobilePackageJsonPath, 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies['@powersync/react-native']).toBe(
      POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE,
    );
    expect(pkg.dependencies['@powersync/common']).toBe(
      POWERSYNC_UPLOAD_RUNTIME_PIN_COMMON,
    );
  });
});

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

  it('PATCH sends normalized opData with update eq id and select id maybeSingle', async () => {
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

  it('DELETE uses delete eq id and select id maybeSingle', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const entry = new CrudEntry(4, UpdateType.DELETE, 'episodes', 'e3');
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    expect(ops).toEqual([{ kind: 'delete', table: 'episodes', id: 'e3' }]);
  });

  it('DELETE completes when PostgREST returns 0 rows (data null, error null)', async () => {
    const { client, ops } = createSupabaseUploadMock({
      zeroRowDeleteForTable: { episodes: true },
    });
    const entry = new CrudEntry(5, UpdateType.DELETE, 'episodes', 'e3-missing');
    await applyPowerSyncCrudEntryToSupabase(client, entry);
    expect(ops).toEqual([
      { kind: 'delete', table: 'episodes', id: 'e3-missing' },
    ]);
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

  describe('episode_symptoms DELETE (bucket paths + Storage after successful PostgREST DELETE)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('lists paths, executes DELETE, then removes Storage when paths are non-empty', async () => {
      const paths = ['user/u1/ep/e1/s/a/file.jpg'];
      mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mockResolvedValue({
        ok: true,
        data: paths,
      });
      mockRemoveEpisodeMediaStorageObjectPathsWithResult.mockResolvedValue({
        ok: true,
      });

      const { client, ops } = createSupabaseUploadMock();
      const execute = jest.fn().mockResolvedValue(undefined);
      const powerSyncDatabase = {
        execute,
      } as unknown as AbstractPowerSyncDatabase;

      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(10, UpdateType.DELETE, 'episode_symptoms', 'sym-1'),
        powerSyncDatabase,
      );

      expect(
        mockListEpisodeMediaBucketPathsForEpisodeSymptomId,
      ).toHaveBeenCalledWith(client, 'sym-1');
      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_symptoms', id: 'sym-1' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).toHaveBeenCalledWith(client, paths);
      expect(
        mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult.mock
          .invocationCallOrder[0],
      );
      expect(execute).toHaveBeenCalledTimes(2);
      expect(String(execute.mock.calls[0][0])).toContain(
        'INSERT OR REPLACE INTO pending_episode_media_storage_cleanup',
      );
      expect(String(execute.mock.calls[1][0])).toContain(
        'DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?',
      );
      expect(execute.mock.calls[1][1]).toEqual([
        'pemsc:episode_symptoms:sym-1',
      ]);
      const persistOrder = execute.mock.invocationCallOrder[0];
      const removeOrder =
        mockRemoveEpisodeMediaStorageObjectPathsWithResult.mock
          .invocationCallOrder[0];
      const clearOrder = execute.mock.invocationCallOrder[1];
      expect(persistOrder).toBeLessThan(removeOrder);
      expect(removeOrder).toBeLessThan(clearOrder);
    });

    it('keeps durable cleanup row when Storage remove fails (no clear)', async () => {
      const paths = ['user/u1/ep/e1/s/a/keep-for-retry.jpg'];
      mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mockResolvedValue({
        ok: true,
        data: paths,
      });
      mockRemoveEpisodeMediaStorageObjectPathsWithResult.mockResolvedValue({
        ok: false,
        error: new PresetDataError('unknown', 'storage 503'),
      });

      const { client, ops } = createSupabaseUploadMock();
      const execute = jest.fn().mockResolvedValue(undefined);
      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(10, UpdateType.DELETE, 'episode_symptoms', 'sym-fail'),
        { execute } as unknown as AbstractPowerSyncDatabase,
      );

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_symptoms', id: 'sym-fail' },
      ]);
      expect(execute).toHaveBeenCalledTimes(1);
      expect(String(execute.mock.calls[0][0])).toContain(
        'INSERT OR REPLACE INTO pending_episode_media_storage_cleanup',
      );
    });

    it('skips Storage cleanup when listed paths are empty', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mockResolvedValue({
        ok: true,
        data: [],
      });

      const { client, ops } = createSupabaseUploadMock();
      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(11, UpdateType.DELETE, 'episode_symptoms', 'sym-2'),
      );

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_symptoms', id: 'sym-2' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });

    it('does not remove Storage when PostgREST DELETE returns an error', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mockResolvedValue({
        ok: true,
        data: ['orphan-risk.mp4'],
      });

      const { client, ops } = createSupabaseUploadMock({
        deleteErrorForTable: {
          episode_symptoms: { message: 'row-level security policy' },
        },
      });

      await expect(
        applyPowerSyncCrudEntryToSupabase(
          client,
          new CrudEntry(12, UpdateType.DELETE, 'episode_symptoms', 'sym-3'),
        ),
      ).rejects.toEqual({ message: 'row-level security policy' });

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_symptoms', id: 'sym-3' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });

    it('does not remove Storage when PostgREST DELETE affects 0 rows (data null, error null)', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mockResolvedValue({
        ok: true,
        data: ['would-be-orphan-if-removed.bin'],
      });

      const { client, ops } = createSupabaseUploadMock({
        zeroRowDeleteForTable: { episode_symptoms: true },
      });

      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(12, UpdateType.DELETE, 'episode_symptoms', 'sym-3b'),
      );

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_symptoms', id: 'sym-3b' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });

    it('does not DELETE or touch Storage when listing paths fails', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeSymptomId.mockResolvedValue({
        ok: false,
        error: new PresetDataError('unknown', 'metadata query failed'),
      });

      const { client, ops } = createSupabaseUploadMock();

      await expect(
        applyPowerSyncCrudEntryToSupabase(
          client,
          new CrudEntry(13, UpdateType.DELETE, 'episode_symptoms', 'sym-4'),
        ),
      ).rejects.toThrow('metadata query failed');

      expect(ops).toEqual([]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });
  });

  describe('episode_media DELETE (bucket paths + Storage after successful PostgREST DELETE)', () => {
    beforeEach(() => {
      jest.clearAllMocks();
    });

    it('lists paths, executes DELETE, then removes Storage when paths are non-empty', async () => {
      const paths = ['user/u1/ep/e1/m/media-id/thumb.jpg'];
      mockListEpisodeMediaBucketPathsForEpisodeMediaId.mockResolvedValue({
        ok: true,
        data: paths,
      });
      mockRemoveEpisodeMediaStorageObjectPathsWithResult.mockResolvedValue({
        ok: true,
      });

      const { client, ops } = createSupabaseUploadMock();
      const execute = jest.fn().mockResolvedValue(undefined);
      const powerSyncDatabase = {
        execute,
      } as unknown as AbstractPowerSyncDatabase;

      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(20, UpdateType.DELETE, 'episode_media', 'med-1'),
        powerSyncDatabase,
      );

      expect(
        mockListEpisodeMediaBucketPathsForEpisodeMediaId,
      ).toHaveBeenCalledWith(client, 'med-1');
      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_media', id: 'med-1' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).toHaveBeenCalledWith(client, paths);
      expect(
        mockListEpisodeMediaBucketPathsForEpisodeMediaId.mock
          .invocationCallOrder[0],
      ).toBeLessThan(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult.mock
          .invocationCallOrder[0],
      );
      expect(execute).toHaveBeenCalledTimes(2);
      expect(String(execute.mock.calls[0][0])).toContain(
        'INSERT OR REPLACE INTO pending_episode_media_storage_cleanup',
      );
      expect(String(execute.mock.calls[1][0])).toContain(
        'DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?',
      );
      expect(execute.mock.calls[1][1]).toEqual(['pemsc:episode_media:med-1']);
      const persistOrder = execute.mock.invocationCallOrder[0];
      const removeOrder =
        mockRemoveEpisodeMediaStorageObjectPathsWithResult.mock
          .invocationCallOrder[0];
      const clearOrder = execute.mock.invocationCallOrder[1];
      expect(persistOrder).toBeLessThan(removeOrder);
      expect(removeOrder).toBeLessThan(clearOrder);
    });

    it('skips Storage cleanup when listed paths are empty', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeMediaId.mockResolvedValue({
        ok: true,
        data: [],
      });

      const { client, ops } = createSupabaseUploadMock();
      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(21, UpdateType.DELETE, 'episode_media', 'med-2'),
      );

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_media', id: 'med-2' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });

    it('does not remove Storage when PostgREST DELETE returns an error', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeMediaId.mockResolvedValue({
        ok: true,
        data: ['keep-until-db-row-gone.bin'],
      });

      const { client, ops } = createSupabaseUploadMock({
        deleteErrorForTable: {
          episode_media: { message: 'JWT expired' },
        },
      });

      await expect(
        applyPowerSyncCrudEntryToSupabase(
          client,
          new CrudEntry(22, UpdateType.DELETE, 'episode_media', 'med-3'),
        ),
      ).rejects.toEqual({ message: 'JWT expired' });

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_media', id: 'med-3' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });

    it('does not remove Storage when PostgREST DELETE affects 0 rows (data null, error null)', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeMediaId.mockResolvedValue({
        ok: true,
        data: ['ghost-path-only.bin'],
      });

      const { client, ops } = createSupabaseUploadMock({
        zeroRowDeleteForTable: { episode_media: true },
      });

      await applyPowerSyncCrudEntryToSupabase(
        client,
        new CrudEntry(22, UpdateType.DELETE, 'episode_media', 'med-3b'),
      );

      expect(ops).toEqual([
        { kind: 'delete', table: 'episode_media', id: 'med-3b' },
      ]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });

    it('does not DELETE or touch Storage when listing paths fails', async () => {
      mockListEpisodeMediaBucketPathsForEpisodeMediaId.mockResolvedValue({
        ok: false,
        error: new PresetDataError('unknown', 'episode_media select failed'),
      });

      const { client, ops } = createSupabaseUploadMock();

      await expect(
        applyPowerSyncCrudEntryToSupabase(
          client,
          new CrudEntry(23, UpdateType.DELETE, 'episode_media', 'med-4'),
        ),
      ).rejects.toThrow('episode_media select failed');

      expect(ops).toEqual([]);
      expect(
        mockRemoveEpisodeMediaStorageObjectPathsWithResult,
      ).not.toHaveBeenCalled();
    });
  });
});

describe('drainPendingEpisodeMediaStorageCleanupQueue', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('no-ops when database lacks getAll/execute', async () => {
    const { client } = createSupabaseUploadMock();
    await drainPendingEpisodeMediaStorageCleanupQueue(client, {
      handleCrudCheckpoint: jest.fn(),
    } as unknown as AbstractPowerSyncDatabase);
    expect(
      mockRemoveEpisodeMediaStorageObjectPathsWithResult,
    ).not.toHaveBeenCalled();
  });

  it('removes Storage for each queued row then deletes the queue row by id', async () => {
    mockRemoveEpisodeMediaStorageObjectPathsWithResult.mockResolvedValue({
      ok: true,
    });
    const { client } = createSupabaseUploadMock();
    const execute = jest.fn().mockResolvedValue(undefined);
    const getAll = jest
      .fn()
      .mockResolvedValue([
        { id: 'q1', storage_paths_json: JSON.stringify(['a/b.jpg']) },
      ]);
    const database = {
      getAll,
      execute,
    } as unknown as AbstractPowerSyncDatabase;

    await drainPendingEpisodeMediaStorageCleanupQueue(client, database);

    expect(getAll).toHaveBeenCalledWith(
      expect.stringContaining(
        'SELECT id, storage_paths_json FROM pending_episode_media_storage_cleanup',
      ),
      [],
    );
    expect(
      mockRemoveEpisodeMediaStorageObjectPathsWithResult,
    ).toHaveBeenCalledWith(client, ['a/b.jpg']);
    const deleteByIdIdx = execute.mock.calls.findIndex(
      (c) =>
        String(c[0]).includes(
          'DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?',
        ) && (c[1] as unknown[] | undefined)?.[0] === 'q1',
    );
    expect(deleteByIdIdx).toBeGreaterThanOrEqual(0);
    const removeCallOrder =
      mockRemoveEpisodeMediaStorageObjectPathsWithResult.mock
        .invocationCallOrder[0];
    expect(execute.mock.invocationCallOrder[deleteByIdIdx]).toBeGreaterThan(
      removeCallOrder,
    );
  });

  it('on Storage remove failure bumps created_at and does not delete the row', async () => {
    mockRemoveEpisodeMediaStorageObjectPathsWithResult.mockResolvedValue({
      ok: false,
      error: new PresetDataError('unknown', 'network'),
    });
    const { client } = createSupabaseUploadMock();
    const execute = jest.fn().mockResolvedValue(undefined);
    const getAll = jest
      .fn()
      .mockResolvedValue([
        { id: 'q2', storage_paths_json: JSON.stringify(['x/y.png']) },
      ]);
    const database = {
      getAll,
      execute,
    } as unknown as AbstractPowerSyncDatabase;

    await drainPendingEpisodeMediaStorageCleanupQueue(client, database);

    expect(
      mockRemoveEpisodeMediaStorageObjectPathsWithResult,
    ).toHaveBeenCalledWith(client, ['x/y.png']);
    const updateIdx = execute.mock.calls.findIndex(
      (c) =>
        String(c[0]).includes(
          'UPDATE pending_episode_media_storage_cleanup SET created_at',
        ) && (c[1] as unknown[] | undefined)?.[1] === 'q2',
    );
    expect(updateIdx).toBeGreaterThanOrEqual(0);
    expect(
      execute.mock.calls.some(
        (c) =>
          String(c[0]).includes(
            'DELETE FROM pending_episode_media_storage_cleanup WHERE id = ?',
          ) && (c[1] as unknown[] | undefined)?.[0] === 'q2',
      ),
    ).toBe(false);
  });
});

describe('uploadPowerSyncCrudBatchToSupabase', () => {
  it('throws when handleCrudCheckpoint is missing (SDK private API contract)', async () => {
    const { client } = createSupabaseUploadMock();
    const database = {} as unknown as AbstractPowerSyncDatabase;
    const batch = new CrudBatch(
      [
        new CrudEntry(1, UpdateType.PUT, 'episodes', 'a', undefined, {
          started_at: '1',
        }),
      ],
      false,
      jest.fn(),
    );
    await expect(
      uploadPowerSyncCrudBatchToSupabase(client, batch, database),
    ).rejects.toThrow(
      `Expected pins: @powersync/react-native ${POWERSYNC_UPLOAD_RUNTIME_PIN_REACT_NATIVE}`,
    );
  });

  it('applies each CRUD entry in order then checkpoints through each client id', async () => {
    const { client, ops } = createSupabaseUploadMock();
    const checkpoint = jest.fn().mockResolvedValue(undefined);
    const database = {
      handleCrudCheckpoint: checkpoint,
    } as unknown as AbstractPowerSyncDatabase;
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
    await uploadPowerSyncCrudBatchToSupabase(client, batch, database);
    expect(ops.map((o) => o.kind)).toEqual(['upsert', 'patch']);
    expect(checkpoint).toHaveBeenCalledTimes(2);
    expect(checkpoint).toHaveBeenNthCalledWith(1, 1);
    expect(checkpoint).toHaveBeenNthCalledWith(2, 2);
    expect(complete).not.toHaveBeenCalled();
  });

  it('checkpoints only successful prefixes when a later entry fails', async () => {
    let upsertCalls = 0;
    const ops: TableOp[] = [];
    const client = {
      from(table: string) {
        return {
          upsert(payload: unknown, options: unknown) {
            upsertCalls += 1;
            if (upsertCalls >= 2) {
              return Promise.resolve({
                error: {
                  message: 'duplicate key value violates unique constraint',
                },
              });
            }
            ops.push({ kind: 'upsert', table, payload, options });
            return Promise.resolve({ error: null });
          },
        };
      },
    } as unknown as AbstrackSupabaseClient;

    const checkpoint = jest.fn().mockResolvedValue(undefined);
    const database = {
      handleCrudCheckpoint: checkpoint,
    } as unknown as AbstractPowerSyncDatabase;

    const batch = new CrudBatch(
      [
        new CrudEntry(1, UpdateType.PUT, 'episodes', 'a', undefined, {
          started_at: '1',
        }),
        new CrudEntry(2, UpdateType.PUT, 'episodes', 'b', undefined, {
          started_at: '2',
        }),
      ],
      false,
      jest.fn().mockResolvedValue(undefined),
    );

    await expect(
      uploadPowerSyncCrudBatchToSupabase(client, batch, database),
    ).rejects.toMatchObject({
      message: 'duplicate key value violates unique constraint',
    });

    expect(ops).toHaveLength(1);
    expect(checkpoint).toHaveBeenCalledTimes(1);
    expect(checkpoint).toHaveBeenCalledWith(1);
  });
});
