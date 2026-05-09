import { waitFor } from '@testing-library/react-native';
import {
  PresetDataError,
  uploadConfirmedEpisodeMedia,
} from '@abstrack/supabase';
import type { PowerSyncDatabase } from '@powersync/react-native';

import { fetchMobileDeviceIsConnected } from '../network/mobile-device-netinfo';
import { getMobileAuthSessionSafe } from '../supabase-wiring';
import * as pendingCrypto from './device-pending-media-crypto';
import {
  createDebouncedPendingEpisodeMediaFlush,
  enqueuePendingEpisodeMediaUploadFromCapture,
  removePendingEpisodeMediaUploadsForSymptomIds,
  runPendingEpisodeMediaUploadWorker,
  shouldQueueEpisodeMediaUploadError,
} from './pending-episode-media-upload';

jest.mock('@abstrack/supabase', () => ({
  ...jest.requireActual<typeof import('@abstrack/supabase')>(
    '@abstrack/supabase',
  ),
  uploadConfirmedEpisodeMedia: jest.fn(),
}));

jest.mock('../supabase-wiring', () => ({
  getMobileSupabaseClient: jest.fn(() => ({ storage: {} })),
  getMobileAuthSessionSafe: jest.fn(),
}));

jest.mock('../powersync/powersync-sqlcipher-key', () => ({
  getOrCreateDeviceSqlcipherKey: jest.fn(
    async () => 'jest-sqlcipher-material-32chars!!',
  ),
}));

jest.mock('../network/mobile-device-netinfo', () => ({
  fetchMobileDeviceIsConnected: jest.fn(),
}));

jest.mock('../random-uuid', () => ({
  newRandomUuidV4: jest.fn(() => '00000000-0000-4000-8000-0000000000a1'),
}));

const mockUploadConfirmedEpisodeMedia = jest.mocked(
  uploadConfirmedEpisodeMedia,
);
const mockFetchConnected = jest.mocked(fetchMobileDeviceIsConnected);
const mockGetSession = jest.mocked(getMobileAuthSessionSafe);

const KEY = 'jest-sqlcipher-material-32chars!!';

function minimalUploadOk() {
  return {
    ok: true as const,
    data: {
      id: 'episode-media-row-1',
      episode_id: 'ep-1',
      episode_symptom_id: 'sym-1',
      storage_object_key: 'k',
      thumbnail_storage_key: null,
    },
  };
}

function createQueueRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'queue-row-1',
    user_id: 'user-1',
    episode_id: '00000000-0000-4000-8000-0000000000e1',
    episode_symptom_id: '00000000-0000-4000-8000-0000000000s1',
    preset_symptom_id: '00000000-0000-4000-8000-0000000000p1',
    last_post_marker_step_completed_at: null,
    media_type: 'photo',
    content_type_primary: 'image/jpeg',
    extension: 'jpg',
    duration_seconds: null,
    primary_cipher_relative_path:
      'abstrack/pending-media/worker-primary-test.bin',
    thumbnail_cipher_relative_path:
      'abstrack/pending-media/worker-thumb-test.jpg',
    attempt_count: 0,
    last_attempt_at: null,
    ...overrides,
  };
}

function createWorkerDbMock(rows: ReturnType<typeof createQueueRow>[]) {
  const execute = jest.fn(async () => undefined);
  const getAll = jest.fn(async (sql: string) => {
    if (sql.includes('WHERE user_id !=')) {
      return [];
    }
    if (
      sql.includes('FROM pending_episode_media_upload') &&
      sql.includes('WHERE user_id = ?')
    ) {
      return rows;
    }
    return [];
  });
  return { getAll, execute };
}

describe('shouldQueueEpisodeMediaUploadError', () => {
  it('queues network_error and unknown preset errors', () => {
    expect(
      shouldQueueEpisodeMediaUploadError(
        new PresetDataError('network_error', 'offline'),
      ),
    ).toBe(true);
    expect(
      shouldQueueEpisodeMediaUploadError(
        new PresetDataError('unknown', 'server'),
      ),
    ).toBe(true);
  });

  it('does not queue validation or permission errors', () => {
    expect(
      shouldQueueEpisodeMediaUploadError(
        new PresetDataError('validation_error', 'bad'),
      ),
    ).toBe(false);
    expect(
      shouldQueueEpisodeMediaUploadError(
        new PresetDataError('permission_denied', 'no'),
      ),
    ).toBe(false);
  });
});

describe('enqueuePendingEpisodeMediaUploadFromCapture', () => {
  const baseArgs = {
    userId: '00000000-0000-4000-8000-0000000000u1' as const,
    episodeId: '00000000-0000-4000-8000-0000000000e1' as const,
    episodeSymptomId: '00000000-0000-4000-8000-0000000000s1' as const,
    presetSymptomId: '00000000-0000-4000-8000-0000000000p1' as const,
    mediaType: 'photo' as const,
    upload: {
      body: new Uint8Array([9, 9, 9]).buffer,
      contentType: 'image/jpeg',
      extension: 'jpg',
      durationSeconds: null as number | null,
      thumbnail: {
        body: new Uint8Array([1]).buffer,
        contentType: 'image/jpeg',
      },
    },
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('includes NULL pass-boundary predicate when episode marker is unset', async () => {
    const execute = jest.fn(async () => undefined);
    const db = {
      getOptional: jest.fn().mockResolvedValue({
        post_marker_step_completed_at: null,
      }),
      getAll: jest.fn().mockResolvedValue([]),
      execute,
    } as unknown as PowerSyncDatabase;

    await enqueuePendingEpisodeMediaUploadFromCapture(db, baseArgs);

    const calls = execute.mock.calls as unknown[][];
    const deleteSql = String(
      calls.find((c) =>
        String(c[0]).includes('DELETE FROM pending_episode_media_upload'),
      )?.[0],
    );
    expect(deleteSql).toContain(
      "(last_post_marker_step_completed_at IS NULL OR last_post_marker_step_completed_at = '')",
    );
  });

  it('uses equality pass-boundary predicate when episode marker is set', async () => {
    const marker = '2024-06-01T12:00:00.000Z';
    const execute = jest.fn(async () => undefined);
    const db = {
      getOptional: jest.fn().mockResolvedValue({
        post_marker_step_completed_at: marker,
      }),
      getAll: jest.fn().mockResolvedValue([]),
      execute,
    } as unknown as PowerSyncDatabase;

    await enqueuePendingEpisodeMediaUploadFromCapture(db, baseArgs);

    const calls = execute.mock.calls as unknown[][];
    const deleteSql = String(
      calls.find((c) =>
        String(c[0]).includes('DELETE FROM pending_episode_media_upload'),
      )?.[0],
    );
    expect(deleteSql).toContain('last_post_marker_step_completed_at = ?');
    const deleteParams = calls.find((c) =>
      String(c[0]).includes('DELETE FROM pending_episode_media_upload'),
    )?.[1] as unknown[];
    expect(deleteParams).toEqual(
      expect.arrayContaining([
        baseArgs.episodeId,
        baseArgs.presetSymptomId,
        marker,
      ]),
    );
  });

  it('after commit deletes ciphertext for replaced rows for the same line + boundary', async () => {
    const deleteSpy = jest.spyOn(
      pendingCrypto,
      'deleteEncryptedPendingMediaFileBestEffort',
    );
    const oldPrimary = 'abstrack/pending-media/old-primary.bin';
    const oldThumb = 'abstrack/pending-media/old-thumb.jpg';
    const execute = jest.fn(async () => undefined);
    const db = {
      getOptional: jest.fn().mockResolvedValue({
        post_marker_step_completed_at: null,
      }),
      getAll: jest.fn().mockResolvedValue([
        {
          primary_cipher_relative_path: oldPrimary,
          thumbnail_cipher_relative_path: oldThumb,
        },
      ]),
      execute,
    } as unknown as PowerSyncDatabase;

    await enqueuePendingEpisodeMediaUploadFromCapture(db, baseArgs);

    expect(deleteSpy).toHaveBeenCalledWith(oldPrimary);
    expect(deleteSpy).toHaveBeenCalledWith(oldThumb);
    deleteSpy.mockRestore();
  });

  it('deletes newly written ciphertext when INSERT fails after BEGIN', async () => {
    const deleteSpy = jest.spyOn(
      pendingCrypto,
      'deleteEncryptedPendingMediaFileBestEffort',
    );
    const execute = jest.fn(async (sql: string) => {
      if (String(sql).includes('INSERT INTO pending_episode_media_upload')) {
        throw new Error('sqlite constraint');
      }
    });
    const db = {
      getOptional: jest.fn().mockResolvedValue({
        post_marker_step_completed_at: null,
      }),
      getAll: jest.fn().mockResolvedValue([]),
      execute,
    } as unknown as PowerSyncDatabase;

    await expect(
      enqueuePendingEpisodeMediaUploadFromCapture(db, baseArgs),
    ).rejects.toThrow('sqlite constraint');

    expect(deleteSpy).toHaveBeenCalledWith(
      'abstrack/pending-media/00000000-0000-4000-8000-0000000000a1-primary.bin',
    );
    expect(deleteSpy).toHaveBeenCalledWith(
      'abstrack/pending-media/00000000-0000-4000-8000-0000000000a1-thumb.jpg',
    );
    deleteSpy.mockRestore();
  });
});

describe('runPendingEpisodeMediaUploadWorker', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchConnected.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({
      data: {
        session: {
          user: { id: 'user-1' },
          access_token: 'token',
        },
      },
    } as never);
  });

  it('returns early when offline (fetchMobileDeviceIsConnected === false)', async () => {
    mockFetchConnected.mockResolvedValue(false);
    const db = createWorkerDbMock([
      createQueueRow(),
    ]) as unknown as PowerSyncDatabase;
    const out = await runPendingEpisodeMediaUploadWorker(db, {});
    expect(out).toEqual({ processed: 0, failures: 0 });
    expect(mockUploadConfirmedEpisodeMedia).not.toHaveBeenCalled();
  });

  it('skips rows still inside exponential backoff window', async () => {
    const row = createQueueRow({
      attempt_count: 1,
      last_attempt_at: new Date(Date.now() - 200).toISOString(),
    });
    const db = createWorkerDbMock([row]) as unknown as PowerSyncDatabase;
    const out = await runPendingEpisodeMediaUploadWorker(db, {});
    expect(out).toEqual({ processed: 0, failures: 0 });
    expect(mockUploadConfirmedEpisodeMedia).not.toHaveBeenCalled();
  });

  it('retries upload after FK violation waits then succeeds', async () => {
    jest.useFakeTimers();
    mockUploadConfirmedEpisodeMedia
      .mockResolvedValueOnce({
        ok: false,
        error: new PresetDataError(
          'foreign_key_violation',
          'parent symptom missing',
        ),
      })
      .mockResolvedValueOnce(minimalUploadOk() as never);

    const row = createQueueRow();
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.primary_cipher_relative_path,
      new Uint8Array([1, 2, 3]).buffer,
    );
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.thumbnail_cipher_relative_path,
      new Uint8Array([4]).buffer,
    );

    const db = createWorkerDbMock([row]) as unknown as PowerSyncDatabase;
    const done = runPendingEpisodeMediaUploadWorker(db, {});
    await jest.advanceTimersByTimeAsync(120);
    const out = await done;
    jest.useRealTimers();

    expect(mockUploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(2);
    expect(out.processed).toBe(1);
    expect(out.failures).toBe(0);
  });

  it('on success deletes ciphertext files and removes the queue row', async () => {
    const deleteSpy = jest.spyOn(
      pendingCrypto,
      'deleteEncryptedPendingMediaFileBestEffort',
    );
    mockUploadConfirmedEpisodeMedia.mockResolvedValue(
      minimalUploadOk() as never,
    );

    const row = createQueueRow();
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.primary_cipher_relative_path,
      new Uint8Array([5]).buffer,
    );
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.thumbnail_cipher_relative_path,
      new Uint8Array([6]).buffer,
    );

    const db = createWorkerDbMock([row]) as unknown as PowerSyncDatabase;
    const out = await runPendingEpisodeMediaUploadWorker(db, {});

    expect(out).toEqual({ processed: 1, failures: 0 });
    expect(deleteSpy).toHaveBeenCalledWith(row.primary_cipher_relative_path);
    expect(deleteSpy).toHaveBeenCalledWith(row.thumbnail_cipher_relative_path);
    const executeMock = db.execute as jest.Mock;
    expect(
      executeMock.mock.calls.some(
        (c) =>
          String(c[0]).includes('DELETE FROM pending_episode_media_upload') &&
          c[1]?.[0] === row.id,
      ),
    ).toBe(true);
    deleteSpy.mockRestore();
  });

  it('on validation failure increments attempt_count without deleting the row', async () => {
    mockUploadConfirmedEpisodeMedia.mockResolvedValue({
      ok: false,
      error: new PresetDataError('validation_error', 'thumbnail rejected'),
    });

    const row = createQueueRow();
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.primary_cipher_relative_path,
      new Uint8Array([7]).buffer,
    );
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.thumbnail_cipher_relative_path,
      new Uint8Array([8]).buffer,
    );

    const db = createWorkerDbMock([row]) as unknown as PowerSyncDatabase;
    const out = await runPendingEpisodeMediaUploadWorker(db, {});

    expect(out).toEqual({ processed: 0, failures: 1 });
    const executeMock = db.execute as jest.Mock;
    const updateCall = executeMock.mock.calls.find((c) =>
      String(c[0]).includes('UPDATE pending_episode_media_upload'),
    );
    expect(updateCall).toBeDefined();
    expect(updateCall?.[1]?.[0]).toBe(1);
    expect(updateCall?.[1]?.[4]).toBe(row.id);
  });
});

describe('removePendingEpisodeMediaUploadsForSymptomIds', () => {
  it('deletes ciphertext paths then removes queue rows', async () => {
    const deleteSpy = jest.spyOn(
      pendingCrypto,
      'deleteEncryptedPendingMediaFileBestEffort',
    );
    const p = 'abstrack/pending-media/r1.bin';
    const t = 'abstrack/pending-media/r1.jpg';
    const getAll = jest.fn(async (sql: string) => {
      if (sql.includes('episode_symptom_id IN')) {
        return [
          {
            primary_cipher_relative_path: p,
            thumbnail_cipher_relative_path: t,
          },
        ];
      }
      return [];
    });
    const execute = jest.fn(async () => undefined);
    const db = { getAll, execute } as unknown as PowerSyncDatabase;

    await removePendingEpisodeMediaUploadsForSymptomIds(db, ['sym-a']);

    expect(deleteSpy).toHaveBeenCalledWith(p);
    expect(deleteSpy).toHaveBeenCalledWith(t);
    const execCalls = execute.mock.calls as unknown[][];
    expect(String(execCalls[0]?.[0])).toContain(
      'DELETE FROM pending_episode_media_upload WHERE episode_symptom_id IN',
    );
    deleteSpy.mockRestore();
  });
});

describe('createDebouncedPendingEpisodeMediaFlush', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFetchConnected.mockResolvedValue(true);
    mockGetSession.mockResolvedValue({
      data: { session: { user: { id: 'u1' }, access_token: 't' } },
    } as never);
  });

  it('coalesces rapid flush calls into a trailing run after minIntervalMs (real timers)', async () => {
    /** Keep the queue row so the debounced second drain still observes work (success deletes the row). */
    mockUploadConfirmedEpisodeMedia.mockResolvedValue({
      ok: false,
      error: new PresetDataError('network_error', 'still offline'),
    });
    const row = createQueueRow({ id: 'debounce-row' });
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.primary_cipher_relative_path,
      new Uint8Array([1]).buffer,
    );
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.thumbnail_cipher_relative_path,
      new Uint8Array([2]).buffer,
    );
    const db = createWorkerDbMock([row]) as unknown as PowerSyncDatabase;
    const minMs = 80;
    const handle = createDebouncedPendingEpisodeMediaFlush(() => db, minMs);

    handle.flush();
    await waitFor(
      () => expect(mockUploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(1),
      { timeout: 2000 },
    );

    handle.flush();
    await waitFor(
      () => expect(mockUploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(2),
      { timeout: 2000 },
    );

    handle.cancel();
  });

  it('cancel drops a trailing debounced worker run', async () => {
    mockUploadConfirmedEpisodeMedia.mockResolvedValue(
      minimalUploadOk() as never,
    );
    const row = createQueueRow({ id: 'debounce-cancel-row' });
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.primary_cipher_relative_path,
      new Uint8Array([3]).buffer,
    );
    await pendingCrypto.writeEncryptedMediaBytesToFile(
      KEY,
      row.thumbnail_cipher_relative_path,
      new Uint8Array([4]).buffer,
    );
    const db = createWorkerDbMock([row]) as unknown as PowerSyncDatabase;
    const handle = createDebouncedPendingEpisodeMediaFlush(() => db, 500);

    handle.flush();
    await waitFor(
      () => expect(mockUploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(1),
      { timeout: 2000 },
    );

    handle.flush();
    handle.cancel();
    await new Promise((r) => setTimeout(r, 600));
    expect(mockUploadConfirmedEpisodeMedia).toHaveBeenCalledTimes(1);
  });
});
