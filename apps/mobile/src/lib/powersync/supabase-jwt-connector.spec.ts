import type { AbstrackSupabaseClient } from '@abstrack/supabase';
import type { AbstractPowerSyncDatabase } from '@powersync/react-native';

import { uploadPowerSyncCrudBatchToSupabase } from './powersync-supabase-upload';
import {
  SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT,
  createSupabaseJwtPowerSyncConnector,
} from './supabase-jwt-connector';

// Connector tests mock the uploader; see powersync-supabase-upload.spec.ts for REST shapes.
jest.mock('./powersync-supabase-upload', () => ({
  uploadPowerSyncCrudBatchToSupabase: jest.fn(
    async (_client: unknown, batch: { complete: () => Promise<void> }) => {
      await batch.complete();
    },
  ),
}));

const powerSyncUrl = 'https://powersync.example.test';
const mockSupabaseClient = {
  mockSupabase: true,
} as unknown as AbstrackSupabaseClient;

describe('createSupabaseJwtPowerSyncConnector', () => {
  beforeEach(() => {
    jest.mocked(uploadPowerSyncCrudBatchToSupabase).mockClear();
  });

  describe('fetchCredentials', () => {
    it('returns null when signed out', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest.fn().mockResolvedValue(null),
        getSupabaseClient: () => mockSupabaseClient,
      });
      await expect(connector.fetchCredentials?.()).resolves.toBeNull();
    });

    it('returns null when session has no access_token', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest.fn().mockResolvedValue({ access_token: '' }),
        getSupabaseClient: () => mockSupabaseClient,
      });
      await expect(connector.fetchCredentials?.()).resolves.toBeNull();
    });

    it('returns endpoint and token when signed in', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest
          .fn()
          .mockResolvedValue({ access_token: 'jwt-token-example' }),
        getSupabaseClient: () => mockSupabaseClient,
      });
      await expect(connector.fetchCredentials?.()).resolves.toEqual({
        endpoint: powerSyncUrl,
        token: 'jwt-token-example',
      });
    });

    it('returns null when getSession rejects (e.g. offline transport)', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest
          .fn()
          .mockRejectedValue(new TypeError('Network request failed')),
        getSupabaseClient: () => mockSupabaseClient,
      });
      await expect(connector.fetchCredentials?.()).resolves.toBeNull();
    });
  });

  describe('uploadData', () => {
    function stubDatabaseSequence(
      batches: Array<{ crud: unknown[]; haveMore: boolean } | null>,
    ): {
      db: AbstractPowerSyncDatabase;
      getCrudBatch: jest.Mock;
      completeMocks: jest.Mock[];
    } {
      const completeMocks: jest.Mock[] = [];
      let index = 0;
      const getCrudBatch = jest.fn(async (limit?: number) => {
        expect(limit).toBe(SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT);
        const spec = batches[index++];
        if (spec === null) {
          return null;
        }
        const complete = jest.fn().mockResolvedValue(undefined);
        completeMocks.push(complete);
        return {
          crud: spec.crud,
          haveMore: spec.haveMore,
          complete,
        };
      });
      const db = { getCrudBatch } as unknown as AbstractPowerSyncDatabase;
      return { db, getCrudBatch, completeMocks };
    }

    it('resolves when there is no CRUD batch', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest.fn(),
        getSupabaseClient: () => mockSupabaseClient,
      });
      const { db, getCrudBatch } = stubDatabaseSequence([null]);
      await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
      expect(getCrudBatch).toHaveBeenCalled();
    });

    it('completes empty batches until haveMore is false', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest.fn(),
        getSupabaseClient: () => mockSupabaseClient,
      });
      const { db, completeMocks } = stubDatabaseSequence([
        { crud: [], haveMore: true },
        { crud: [], haveMore: false },
      ]);
      await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
      expect(completeMocks).toHaveLength(2);
      expect(completeMocks[0]).toHaveBeenCalledTimes(1);
      expect(completeMocks[1]).toHaveBeenCalledTimes(1);
    });

    it('uploads non-empty batches via Supabase and completes them', async () => {
      const connector = createSupabaseJwtPowerSyncConnector({
        powerSyncUrl,
        getSession: jest.fn(),
        getSupabaseClient: () => mockSupabaseClient,
      });
      const complete = jest.fn().mockResolvedValue(undefined);
      const batch = {
        crud: [{ id: '1' }],
        haveMore: false,
        complete,
      };
      const getCrudBatch = jest.fn().mockResolvedValue(batch);
      const db = {
        getCrudBatch,
      } as unknown as AbstractPowerSyncDatabase;

      await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
      expect(getCrudBatch).toHaveBeenCalledWith(
        SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT,
      );
      expect(uploadPowerSyncCrudBatchToSupabase).toHaveBeenCalledTimes(1);
      expect(uploadPowerSyncCrudBatchToSupabase).toHaveBeenCalledWith(
        mockSupabaseClient,
        batch,
      );
      expect(complete).toHaveBeenCalledTimes(1);
    });

    it('does not complete batch when upload fails with transient network error', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        jest
          .mocked(uploadPowerSyncCrudBatchToSupabase)
          .mockRejectedValueOnce(new TypeError('Network request failed'));
        const connector = createSupabaseJwtPowerSyncConnector({
          powerSyncUrl,
          getSession: jest.fn(),
          getSupabaseClient: () => mockSupabaseClient,
        });
        const complete = jest.fn().mockResolvedValue(undefined);
        const batch = {
          crud: [{ id: '1' }],
          haveMore: false,
          complete,
        };
        const getCrudBatch = jest.fn().mockResolvedValue(batch);
        const db = {
          getCrudBatch,
        } as unknown as AbstractPowerSyncDatabase;

        await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
        expect(getCrudBatch).toHaveBeenCalledWith(
          SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT,
        );
        expect(complete).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('completes batch when upload fails with permanent server rejection', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        jest.mocked(uploadPowerSyncCrudBatchToSupabase).mockRejectedValueOnce({
          code: '23503',
          message: 'violates foreign key constraint',
        });
        const connector = createSupabaseJwtPowerSyncConnector({
          powerSyncUrl,
          getSession: jest.fn(),
          getSupabaseClient: () => mockSupabaseClient,
        });
        const complete = jest.fn().mockResolvedValue(undefined);
        const batch = {
          crud: [{ id: '1' }],
          haveMore: false,
          complete,
        };
        const getCrudBatch = jest.fn().mockResolvedValue(batch);
        const db = {
          getCrudBatch,
        } as unknown as AbstractPowerSyncDatabase;

        await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
        expect(getCrudBatch).toHaveBeenCalledWith(
          SUPABASE_JWT_POWERSYNC_UPLOAD_CRUD_BATCH_LIMIT,
        );
        expect(complete).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('fetches the next batch after permanent failure when the queue still has entries', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        jest.mocked(uploadPowerSyncCrudBatchToSupabase).mockRejectedValueOnce({
          code: '23503',
          message: 'violates foreign key constraint',
        });
        const connector = createSupabaseJwtPowerSyncConnector({
          powerSyncUrl,
          getSession: jest.fn(),
          getSupabaseClient: () => mockSupabaseClient,
        });
        const { db, getCrudBatch, completeMocks } = stubDatabaseSequence([
          { crud: [{ id: '1' }], haveMore: true },
          { crud: [{ id: '2' }], haveMore: false },
        ]);

        await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
        expect(getCrudBatch).toHaveBeenCalledTimes(2);
        expect(uploadPowerSyncCrudBatchToSupabase).toHaveBeenCalledTimes(2);
        expect(completeMocks[0]).toHaveBeenCalledTimes(1);
        expect(completeMocks[1]).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });

    it('stops upload pass when batch.complete fails after permanent rejection', async () => {
      const warnSpy = jest
        .spyOn(console, 'warn')
        .mockImplementation(() => undefined);
      try {
        jest.mocked(uploadPowerSyncCrudBatchToSupabase).mockRejectedValueOnce({
          code: '23503',
          message: 'violates foreign key constraint',
        });
        const connector = createSupabaseJwtPowerSyncConnector({
          powerSyncUrl,
          getSession: jest.fn(),
          getSupabaseClient: () => mockSupabaseClient,
        });
        const { db, getCrudBatch, completeMocks } = stubDatabaseSequence([
          { crud: [{ id: '1' }], haveMore: true },
          { crud: [{ id: '2' }], haveMore: false },
        ]);
        completeMocks[0] = jest
          .fn()
          .mockRejectedValue(new Error('sqlite busy while dequeueing'));
        jest
          .mocked(getCrudBatch)
          .mockResolvedValueOnce({
            crud: [{ id: '1' }],
            haveMore: true,
            complete: completeMocks[0],
          })
          .mockResolvedValueOnce({
            crud: [{ id: '2' }],
            haveMore: false,
            complete: jest.fn().mockResolvedValue(undefined),
          });

        await expect(connector.uploadData?.(db)).resolves.toBeUndefined();
        expect(getCrudBatch).toHaveBeenCalledTimes(1);
        expect(uploadPowerSyncCrudBatchToSupabase).toHaveBeenCalledTimes(1);
        expect(completeMocks[0]).toHaveBeenCalledTimes(1);
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
