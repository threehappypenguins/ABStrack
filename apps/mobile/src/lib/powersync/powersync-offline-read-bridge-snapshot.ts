import type { PowerSyncDatabase } from '@powersync/react-native';

import { PresetDataError } from '@abstrack/supabase';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** Mirrors `@abstrack/supabase` transport heuristics; RN often yields `PresetDataError` code `unknown` with message `Network request failed`. */
function messageLooksLikeFetchTransportFailure(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes('failed to fetch') ||
    m.includes('networkerror when attempting') ||
    m.includes('load failed') ||
    m.includes('network request failed') ||
    m.includes('the network connection was lost') ||
    m.includes('internet connection appears to be offline') ||
    m.includes('could not connect to the server')
  );
}

function readErrorProbe(error: unknown): { code?: string; message: string } {
  if (error instanceof Error) {
    const code =
      'code' in error && typeof (error as { code?: unknown }).code === 'string'
        ? (error as { code: string }).code
        : undefined;
    return { code, message: error.message ?? '' };
  }
  if (isRecord(error)) {
    const code = typeof error.code === 'string' ? error.code : undefined;
    const message = typeof error.message === 'string' ? error.message : '';
    return { code, message };
  }
  return { message: '' };
}

type Snapshot = {
  database: PowerSyncDatabase | null;
  firstSyncCompleted: boolean;
  /**
   * True after {@link PowerSyncDatabase.init} on the open handle. Required before SQL runs, but not
   * sufficient alone to treat server-mirror tables as populated (see {@link firstSyncLandedOnDevice}).
   */
  localSqliteInitialized: boolean;
  powerSyncUrlConfigured: boolean;
  /**
   * True once {@link getPowerSyncFirstSyncLandedForUser} has resolved for the signed-in user (or
   * immediately when signed out). Until then, offline preset/template fallbacks stay conservative.
   */
  firstSyncLandingHydrated: boolean;
  /**
   * Persisted: this user has completed at least one first sync on this device. Survives process restarts
   * so cold start offline still allows SQLite reads after a prior online session.
   */
  firstSyncLandedOnDevice: boolean;
};

const snapshot: Snapshot = {
  database: null,
  firstSyncCompleted: false,
  localSqliteInitialized: false,
  powerSyncUrlConfigured: false,
  firstSyncLandingHydrated: true,
  firstSyncLandedOnDevice: false,
};

/**
 * Updates the latest PowerSync bridge fields used to gate SQLite-backed reads when Supabase fails
 * offline. Called from {@link PowerSyncSessionBridge} whenever bridge state changes.
 *
 * @param next - Current replication flags and DB handle.
 */
export function setPowerSyncOfflineReadBridgeSnapshot(next: Snapshot): void {
  snapshot.database = next.database;
  snapshot.firstSyncCompleted = next.firstSyncCompleted;
  snapshot.localSqliteInitialized = next.localSqliteInitialized;
  snapshot.powerSyncUrlConfigured = next.powerSyncUrlConfigured;
  snapshot.firstSyncLandingHydrated = next.firstSyncLandingHydrated;
  snapshot.firstSyncLandedOnDevice = next.firstSyncLandedOnDevice;
}

/**
 * @returns `true` when read-only SQL may treat server-mirror replica content as trustworthy for
 *   offline fallbacks: URL configured, DB open, SQLite initialized, landing hydration done, and either
 *   first sync finished this session or a prior run persisted first-sync landing for this user.
 */
export function canUsePowerSyncReplicaForOfflineReads(): boolean {
  const mirrorDataTrusted =
    snapshot.firstSyncCompleted ||
    (snapshot.firstSyncLandingHydrated && snapshot.firstSyncLandedOnDevice);
  return Boolean(
    snapshot.database &&
      snapshot.powerSyncUrlConfigured &&
      snapshot.localSqliteInitialized &&
      mirrorDataTrusted,
  );
}

/**
 * @returns The open PowerSync database when {@link canUsePowerSyncReplicaForOfflineReads} is true;
 *   otherwise `null`.
 */
export function getPowerSyncDatabaseForOfflineReads(): PowerSyncDatabase | null {
  return canUsePowerSyncReplicaForOfflineReads() ? snapshot.database : null;
}

/**
 * Optional caller-supplied PowerSync handle (from {@link usePowerSyncBridgeState} in UI). Prefer
 * this over the module snapshot alone so list reads use the **same** DB reference React already has
 * after `connect` / `waitForFirstSync` (see PowerSync JS SDK lifecycle docs).
 */
export type PowerSyncOfflineReadContext = {
  database: PowerSyncDatabase | null;
  /**
   * True when the same conditions as {@link canUsePowerSyncReplicaForOfflineReads} hold for the
   * current bridge snapshot (URL, DB, SQLite init, and first-sync landing / session completion).
   */
  replicationReady: boolean;
};

/**
 * Resolves which open {@link PowerSyncDatabase} to read for offline fallbacks: explicit
 * {@link PowerSyncOfflineReadContext} from a screen wins; otherwise {@link getPowerSyncDatabaseForOfflineReads}.
 *
 * @param context - From `usePowerSyncBridgeState()` at call time, or omit for non-UI callers.
 */
export function resolvePowerSyncDatabaseForOfflineRead(
  context?: PowerSyncOfflineReadContext | null,
): PowerSyncDatabase | null {
  if (context && context.replicationReady && context.database != null) {
    return context.database;
  }
  return getPowerSyncDatabaseForOfflineReads();
}

/**
 * Whether a failed remote read was probably caused by connectivity / fetch transport.
 *
 * Uses duck-typed `code === 'network_error'` and message heuristics so:
 * - Metro duplicate `@abstrack/supabase` copies do not break `instanceof {@link PresetDataError}`.
 * - Wrappers that map fetch failures to {@link PresetDataError} `unknown` (but keep `message`) still
 *   trigger the PowerSync SQLite fallback.
 *
 * @param error - Value from a failed {@link PresetDataResult} or thrown rejection.
 */
export function isPresetDataNetworkError(error: unknown): boolean {
  if (error instanceof PresetDataError && error.code === 'network_error') {
    return true;
  }
  const { code, message } = readErrorProbe(error);
  if (code === 'network_error') {
    return true;
  }
  if (message.length > 0 && messageLooksLikeFetchTransportFailure(message)) {
    return true;
  }
  return false;
}

/**
 * When a list read failed with a transport-style error (see {@link isPresetDataNetworkError}) but the
 * encrypted replica is not usable for server-mirror reads yet (PowerSync URL is set but the DB is not
 * open, SQLite is not initialized, landing flags say first sync never completed on this device, etc.),
 * returns clearer copy so users do not think the app is only “broken offline.”
 * Otherwise `null` and callers should keep the original error.
 *
 * @param remoteError - Error from a failed Supabase-backed list fetch.
 */
export function clarifyNetworkErrorWhenReplicaUnavailable(
  remoteError: unknown,
): PresetDataError | null {
  if (!isPresetDataNetworkError(remoteError)) {
    return null;
  }
  if (canUsePowerSyncReplicaForOfflineReads()) {
    return null;
  }
  if (!snapshot.powerSyncUrlConfigured) {
    return null;
  }
  const cause =
    remoteError instanceof PresetDataError
      ? remoteError.cause
      : remoteError instanceof Error
        ? remoteError
        : undefined;
  return new PresetDataError(
    'network_error',
    'Open the app while online once so presets and templates sync to this device. Then you can use these tabs offline.',
    cause,
  );
}
