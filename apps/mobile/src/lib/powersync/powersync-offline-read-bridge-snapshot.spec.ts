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
      syncConnecting: false,
      syncError: null,
      powerSyncUrlConfigured: false,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
    });
  });

  it('returns clearer message when URL configured but replica not readable', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: null,
      firstSyncCompleted: false,
      localSqliteInitialized: false,
      syncConnecting: false,
      syncError: null,
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
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
      localSqliteInitialized: true,
      syncConnecting: false,
      syncError: null,
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
    });
    const err = new PresetDataError('network_error', 'offline');
    expect(clarifyNetworkErrorWhenReplicaUnavailable(err)).toBeNull();
  });

  it('returns clearer message when SQLite is initialized but first sync never landed on device', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: false,
      localSqliteInitialized: true,
      syncConnecting: false,
      syncError: null,
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
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

  it('returns null when first sync incomplete but persisted landing says replica was populated before', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: false,
      localSqliteInitialized: true,
      syncConnecting: false,
      syncError: null,
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: true,
    });
    const err = new PresetDataError(
      'unknown',
      'Network request failed',
      new TypeError('Network request failed'),
    );
    expect(clarifyNetworkErrorWhenReplicaUnavailable(err)).toBeNull();
  });

  it('returns null while syncConnecting so callers keep the raw transport error', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: false,
      localSqliteInitialized: false,
      syncConnecting: true,
      syncError: null,
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
    });
    const err = new PresetDataError(
      'unknown',
      'Network request failed',
      new TypeError('Network request failed'),
    );
    expect(clarifyNetworkErrorWhenReplicaUnavailable(err)).toBeNull();
  });

  it('uses offline replica infrastructure copy when bridge recorded an encrypted DB open failure', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: null,
      firstSyncCompleted: false,
      localSqliteInitialized: false,
      syncConnecting: false,
      syncError: new Error('Unable to open encrypted database (mock)'),
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
    });
    const err = new PresetDataError(
      'unknown',
      'Network request failed',
      new TypeError('Network request failed'),
    );
    const next = clarifyNetworkErrorWhenReplicaUnavailable(err);
    expect(next).not.toBeNull();
    expect(next?.message).toContain('encrypted offline copy');
    expect(next?.message).not.toContain('online once');
    expect(next?.cause).toBeInstanceOf(Error);
  });

  it('keeps onboarding-style message when syncError is only the offline first-sync delay hint', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: false,
      localSqliteInitialized: true,
      syncConnecting: false,
      syncError: new Error(
        'First sync is taking longer than expected (often no network). Try again when online.',
      ),
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
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

  it('uses infrastructure copy when SQLite never initialized but a DB handle exists', () => {
    setPowerSyncOfflineReadBridgeSnapshot({
      database: {} as never,
      firstSyncCompleted: false,
      localSqliteInitialized: false,
      syncConnecting: false,
      syncError: new Error('SQLite init failed (mock)'),
      powerSyncUrlConfigured: true,
      firstSyncLandingHydrated: true,
      firstSyncLandedOnDevice: false,
    });
    const err = new PresetDataError(
      'unknown',
      'Network request failed',
      new TypeError('Network request failed'),
    );
    const next = clarifyNetworkErrorWhenReplicaUnavailable(err);
    expect(next).not.toBeNull();
    expect(next?.message).toContain('encrypted offline copy');
  });
});
