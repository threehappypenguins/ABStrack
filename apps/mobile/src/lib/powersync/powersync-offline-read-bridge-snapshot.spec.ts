import { PresetDataError } from '@abstrack/supabase';

import {
  clarifyNetworkErrorWhenReplicaUnavailable,
  isPresetDataNetworkError,
  setPowerSyncOfflineReadBridgeSnapshot,
} from './powersync-offline-read-bridge-snapshot';

describe('isPresetDataNetworkError', () => {
  it('is true for PresetDataError network_error', () => {
    expect(
      isPresetDataNetworkError(
        new PresetDataError(
          'network_error',
          'Could not reach the server. Check your connection and try again.',
        ),
      ),
    ).toBe(true);
  });

  it('is true when code is network_error without instanceof (duplicate bundle)', () => {
    expect(
      isPresetDataNetworkError({
        code: 'network_error',
        message:
          'Could not reach the server. Check your connection and try again.',
      }),
    ).toBe(true);
  });

  it('is true for PresetDataError unknown with RN fetch message', () => {
    expect(
      isPresetDataNetworkError(
        new PresetDataError(
          'unknown',
          'Network request failed',
          new TypeError('fail'),
        ),
      ),
    ).toBe(true);
  });

  it('is true for TypeError with RN message', () => {
    expect(
      isPresetDataNetworkError(new TypeError('Network request failed')),
    ).toBe(true);
  });

  it('is false for unrelated failures', () => {
    expect(isPresetDataNetworkError(new Error('Invalid column'))).toBe(false);
    expect(
      isPresetDataNetworkError({ code: '23503', message: 'fk violation' }),
    ).toBe(false);
  });
});

describe('clarifyNetworkErrorWhenReplicaUnavailable', () => {
  afterEach(() => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: null,
      firstSyncCompleted: false,
      localSqliteInitialized: false,
      powerSyncUrlConfigured: false,
    });
  });

  it('returns clearer message when URL configured but replica not readable', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: null,
      firstSyncCompleted: false,
      localSqliteInitialized: false,
      powerSyncUrlConfigured: true,
    });
    const err = new PresetDataError(
      'unknown',
      'Network request failed',
      new TypeError('Network request failed'),
    );
    const next = clarifyNetworkErrorWhenReplicaUnavailable(err);
    expect(next).not.toBeNull();
    expect(next?.message).toContain('online once');
  });

  it('returns null when replica is already usable', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: true,
      localSqliteInitialized: false,
      powerSyncUrlConfigured: true,
    });
    const err = new PresetDataError('network_error', 'offline');
    expect(clarifyNetworkErrorWhenReplicaUnavailable(err)).toBeNull();
  });

  it('returns null when local SQLite initialized but first sync incomplete', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: false,
      localSqliteInitialized: true,
      powerSyncUrlConfigured: true,
    });
    const err = new PresetDataError(
      'unknown',
      'Network request failed',
      new TypeError('Network request failed'),
    );
    expect(clarifyNetworkErrorWhenReplicaUnavailable(err)).toBeNull();
  });
});
