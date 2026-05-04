import type { Session } from '@abstrack/supabase';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { PowerSyncContext } from '@powersync/react';
import type {
  PowerSyncBackendConnector,
  PowerSyncDatabase,
} from '@powersync/react-native';

import {
  getMobileAuthSessionSafe,
  getMobileSupabaseClient,
} from '../supabase-wiring';
import { createSupabaseJwtPowerSyncConnector } from './supabase-jwt-connector';
import { getMobilePowerSyncUrl } from './powersync-env';
import { getOrCreateDeviceSqlcipherKey } from './powersync-sqlcipher-key';
import {
  getPowerSyncFirstSyncLandedForUser,
  markPowerSyncFirstSyncLandedForUser,
} from './powersync-first-sync-landing-storage';
import { setPowerSyncOfflineReadBridgeSnapshot } from './powersync-offline-read-bridge-snapshot';
import {
  isPowerSyncReplicaDiagnosticsEnabled,
  runPowerSyncReplicaDiagnostics,
} from './powersync-replica-diagnostics';
import {
  registerPowerSyncSyncStatusDiagnostics,
  summarizePowerSyncSyncStatusForLog,
  wrapPowerSyncBackendConnectorWithFetchDiagnostics,
} from './powersync-sync-diagnostics';
import { getSharedPowerSyncDatabase } from './powersync-shared-db';

/**
 * Bridge status for UI and read-model hooks (first sync, errors, URL presence).
 */
export type PowerSyncBridgeState = {
  /**
   * True when the user is signed in and `EXPO_PUBLIC_POWERSYNC_URL` is set — compact sync chrome
   * (footer, pull-to-resync) may be shown even before the local DB handle exists.
   */
  syncChromeEnabled: boolean;
  /** True when `EXPO_PUBLIC_POWERSYNC_URL` is non-empty at bundle time. */
  powerSyncUrlConfigured: boolean;
  /** Local DB instance when replication is enabled for this install; `null` before first open. */
  database: PowerSyncDatabase | null;
  /** True after {@link PowerSyncDatabase.waitForFirstSync} completes for the current connection. */
  firstSyncCompleted: boolean;
  /**
   * True after {@link PowerSyncDatabase.init} succeeds for this open handle. Unlike
   * {@link firstSyncCompleted}, this becomes true even when `waitForFirstSync` never finishes
   * (e.g. cold start offline), so read-only SQL against **persisted** replica data can still run.
   */
  localSqliteInitialized: boolean;
  /** True while `init` / `connect` / first sync are in flight. */
  syncConnecting: boolean;
  /** Set when connect or first sync fails (logged-out cleanup errors are ignored). */
  syncError: Error | null;
  /**
   * Persisted marker: this user has completed at least one {@link PowerSyncDatabase.waitForFirstSync}
   * on this device. Survives restarts so offline reads work after a prior online session when
   * {@link firstSyncCompleted} is still false on cold start.
   */
  firstSyncLandedOnDevice: boolean;
  /**
   * False while loading {@link firstSyncLandedOnDevice} from storage for the signed-in user.
   * Signed-out bridge treats this as hydrated immediately.
   */
  firstSyncLandingHydrated: boolean;
};

const defaultBridgeState: PowerSyncBridgeState = {
  syncChromeEnabled: false,
  powerSyncUrlConfigured: false,
  database: null,
  firstSyncCompleted: false,
  localSqliteInitialized: false,
  syncConnecting: false,
  syncError: null,
  firstSyncLandedOnDevice: false,
  firstSyncLandingHydrated: true,
};

const PowerSyncBridgeContext =
  createContext<PowerSyncBridgeState>(defaultBridgeState);

/**
 * @returns PowerSync lifecycle flags for gating SQLite-backed reads.
 */
export function usePowerSyncBridgeState(): PowerSyncBridgeState {
  return useContext(PowerSyncBridgeContext);
}

export type PowerSyncManualResyncContextValue = {
  /**
   * Disconnects and reconnects the PowerSync stream (upload + download), clears a stale
   * {@link PowerSyncBridgeState.syncError} after a successful `connect`, and awaits first sync
   * again when needed, with a **60s** cap on `waitForFirstSync` so the UI cannot hang indefinitely
   * offline. Safe to call when the replica is disabled or the DB is not open — it no-ops.
   */
  requestManualResync: () => Promise<void>;
  /** True while {@link requestManualResync} is running. */
  manualResyncBusy: boolean;
};

const defaultManualResync: PowerSyncManualResyncContextValue = {
  requestManualResync: async () => {
    void 0;
  },
  manualResyncBusy: false,
};

const PowerSyncManualResyncContext =
  createContext<PowerSyncManualResyncContextValue>(defaultManualResync);

/**
 * @returns Manual PowerSync reconnect controls for pull-to-refresh and the sync footer.
 */
export function usePowerSyncManualResync(): PowerSyncManualResyncContextValue {
  return useContext(PowerSyncManualResyncContext);
}

/**
 * Whether preset/template list screens may issue read-only SQL against the encrypted replica for
 * server-mirror data. Requires SQLite init plus either first sync this session or a persisted
 * {@link PowerSyncBridgeState.firstSyncLandedOnDevice} flag so a **fresh install offline** does not
 * treat an empty replica as authoritative.
 *
 * @param bridge - Latest {@link usePowerSyncBridgeState} value.
 */
export function powerSyncOfflineReplicaReadsEnabled(
  bridge: PowerSyncBridgeState,
): boolean {
  const mirrorTrusted =
    bridge.firstSyncCompleted ||
    (bridge.firstSyncLandingHydrated && bridge.firstSyncLandedOnDevice);
  return Boolean(
    bridge.powerSyncUrlConfigured &&
      bridge.database &&
      bridge.localSqliteInitialized &&
      mirrorTrusted,
  );
}

/**
 * True when the replica handle exists and {@link PowerSyncBridgeState.localSqliteInitialized} is
 * set (i.e. {@link PowerSyncDatabase.init} has finished). Mount PowerSync `useQuery` read subscriptions
 * only when this is true: {@link PowerSyncSessionBridge} assigns `database` before `init()`
 * completes, so `database` alone is not enough on cold start.
 *
 * @param bridge - Latest {@link usePowerSyncBridgeState} value.
 */
export function powerSyncReplicaSqliteReady(
  bridge: PowerSyncBridgeState,
): boolean {
  return Boolean(bridge.database && bridge.localSqliteInitialized);
}

/** Caps {@link PowerSyncDatabase.waitForFirstSync} during manual resync so pull-to-refresh / Sync now cannot spin forever offline. */
const MANUAL_RESYNC_WAIT_FOR_FIRST_SYNC_MS = 60_000;

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof Error && error.name === 'AbortError') ||
    (typeof DOMException !== 'undefined' &&
      error instanceof DOMException &&
      error.name === 'AbortError')
  );
}

/**
 * Opens the encrypted PowerSync DB when a session and PowerSync URL exist, connects with the
 * Supabase JWT connector, awaits first sync, and clears replicated data on sign-out via
 * {@link PowerSyncDatabase.disconnectAndClear}.
 *
 * **Logout:** When `session` loses `access_token`, runs `disconnectAndClear` so stale JWTs are not
 * used and local PHI replica is wiped. `fetchCredentials` already returns `null` when signed out;
 * disconnect ensures no lingering sync connection.
 *
 * @param props.session - Current Supabase session or `null`.
 * @param props.children - Authenticated app tree (also wraps auth stack so logout effects run).
 * @returns Provider hierarchy for PowerSync React hooks.
 */
export function PowerSyncSessionBridge({
  session,
  children,
}: {
  session: Session | null;
  children: React.ReactNode;
}) {
  const powerSyncUrl = useMemo(() => getMobilePowerSyncUrl(), []);
  const urlConfigured = powerSyncUrl.length > 0;

  /**
   * Boolean session gate for effects: Supabase emits multiple auth events at cold start and on
   * refresh; `session.access_token` changes often while still signed in. Depending on the raw token
   * retriggers connect teardown/reconnect and stresses PowerSync (`Deferred` "Trying to close for the
   * second time" warnings). Connector `getSession` already reads the latest JWT from Supabase.
   */
  const hasAuthSession = Boolean(session?.access_token);

  const [db, setDb] = useState<PowerSyncDatabase | null>(null);
  const [firstSyncCompleted, setFirstSyncCompleted] = useState(false);
  const [localSqliteInitialized, setLocalSqliteInitialized] = useState(false);
  const [firstSyncLandedOnDevice, setFirstSyncLandedOnDevice] = useState(false);
  const [firstSyncLandingHydrated, setFirstSyncLandingHydrated] =
    useState(true);
  const [syncConnecting, setSyncConnecting] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);

  const buildConnector = useCallback((): PowerSyncBackendConnector => {
    const baseConnector = createSupabaseJwtPowerSyncConnector({
      powerSyncUrl,
      getSession: async () => {
        try {
          const { data } = await getMobileAuthSessionSafe();
          const next = data.session;
          if (!next?.access_token) {
            return null;
          }
          return { access_token: next.access_token };
        } catch {
          return null;
        }
      },
      getSupabaseClient: () => getMobileSupabaseClient(),
    });
    return isPowerSyncReplicaDiagnosticsEnabled()
      ? wrapPowerSyncBackendConnectorWithFetchDiagnostics(
          baseConnector,
          (jsonLine) => {
            console.info('[PowerSyncReplicaDiag:fetch_credentials]', jsonLine);
          },
        )
      : baseConnector;
  }, [powerSyncUrl]);

  /** Latest session for connect-effect cleanup (skip redundant disconnect on sign-out). */
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** Latest URL flag: cleanup disconnects when replication is disabled while still signed in. */
  const urlConfiguredRef = useRef(urlConfigured);
  urlConfiguredRef.current = urlConfigured;

  const recordFirstSyncLanded = useCallback(() => {
    const userId = sessionRef.current?.user?.id;
    if (!userId) {
      return;
    }
    setFirstSyncLandedOnDevice(true);
    void markPowerSyncFirstSyncLandedForUser(userId);
  }, []);

  useEffect(() => {
    const userId = session?.user?.id;
    if (!userId) {
      setFirstSyncLandedOnDevice(false);
      setFirstSyncLandingHydrated(true);
      return;
    }
    let cancelled = false;
    setFirstSyncLandingHydrated(false);
    void (async () => {
      try {
        const landed = await getPowerSyncFirstSyncLandedForUser(userId);
        if (!cancelled) {
          setFirstSyncLandedOnDevice(landed);
        }
      } finally {
        if (!cancelled) {
          setFirstSyncLandingHydrated(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  const manualResyncBusyRef = useRef(false);
  const [manualResyncBusy, setManualResyncBusy] = useState(false);

  const requestManualResync = useCallback(async () => {
    if (!db || !hasAuthSession || !urlConfigured) {
      return;
    }
    if (manualResyncBusyRef.current) {
      return;
    }
    manualResyncBusyRef.current = true;
    setManualResyncBusy(true);
    try {
      const connector = buildConnector();
      await db.disconnect();
      if (!sessionRef.current?.access_token) {
        return;
      }
      await db.connect(connector);
      setSyncError(null);
      let firstSyncWaitTimedOut = false;
      try {
        const ac = new AbortController();
        const timeoutId = setTimeout(() => {
          firstSyncWaitTimedOut = true;
          ac.abort();
        }, MANUAL_RESYNC_WAIT_FOR_FIRST_SYNC_MS);
        try {
          await db.waitForFirstSync(ac.signal);
          setFirstSyncCompleted(true);
          recordFirstSyncLanded();
        } finally {
          clearTimeout(timeoutId);
        }
      } catch (waitErr) {
        if (isAbortError(waitErr) && firstSyncWaitTimedOut) {
          setSyncError(
            new Error(
              'First sync is taking longer than expected (often no network). Try again when online.',
            ),
          );
        } else if (!isAbortError(waitErr)) {
          setSyncError(
            waitErr instanceof Error ? waitErr : new Error(String(waitErr)),
          );
        }
      }
    } catch (e) {
      console.warn('[PowerSync] Manual resync failed.', e);
      if (!isAbortError(e)) {
        setSyncError(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      manualResyncBusyRef.current = false;
      setManualResyncBusy(false);
    }
  }, [
    buildConnector,
    db,
    hasAuthSession,
    recordFirstSyncLanded,
    urlConfigured,
  ]);

  /**
   * If the stream recovers (e.g. device was offline during `waitForFirstSync`), PowerSync updates
   * status while {@link syncError} can remain set from the earlier catch — the footer would stay
   * red until a full effect re-run. Clear stale bridge errors when the client reports healthy.
   */
  useEffect(() => {
    if (!db) {
      return;
    }
    return db.registerListener({
      statusChanged: (status) => {
        const df = status.dataFlowStatus;
        const healthy =
          status.connected && !df?.uploadError && !df?.downloadError;
        if (healthy) {
          setSyncError((prev) => (prev ? null : prev));
        }
      },
    });
  }, [db]);

  const manualResyncContextValue = useMemo(
    (): PowerSyncManualResyncContextValue => ({
      requestManualResync,
      manualResyncBusy,
    }),
    [manualResyncBusy, requestManualResync],
  );

  useEffect(() => {
    if (!hasAuthSession || !urlConfigured) {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const key = await getOrCreateDeviceSqlcipherKey();
        if (cancelled) {
          return;
        }
        setDb(getSharedPowerSyncDatabase(key));
      } catch (e) {
        console.warn('[PowerSync] Unable to open encrypted database', e);
        if (!cancelled) {
          setSyncError(e instanceof Error ? e : new Error(String(e)));
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasAuthSession, urlConfigured]);

  useEffect(() => {
    if (!db || !hasAuthSession || !urlConfigured) {
      return;
    }

    const connector = buildConnector();

    const ac = new AbortController();
    let cancelled = false;
    let reachedAfterWaitForFirstSync = false;
    let syncCaughtMessage: string | undefined;
    let firstSyncWatchdogId: ReturnType<typeof setTimeout> | undefined;
    let disposeSyncStatusDiag: (() => void) | undefined;

    const clearFirstSyncWatchdog = () => {
      if (firstSyncWatchdogId != null) {
        clearTimeout(firstSyncWatchdogId);
        firstSyncWatchdogId = undefined;
      }
    };

    void (async () => {
      try {
        setSyncError(null);
        setSyncConnecting(true);
        setFirstSyncCompleted(false);
        setLocalSqliteInitialized(false);
        await db.init();
        if (!cancelled) {
          setLocalSqliteInitialized(true);
        }
        if (!cancelled && isPowerSyncReplicaDiagnosticsEnabled()) {
          void runPowerSyncReplicaDiagnostics(db).then((diag) => {
            console.info(
              '[PowerSyncReplicaDiag:after_sqlite_init]',
              JSON.stringify(diag),
            );
          });
        }
        await db.connect(connector);
        if (!cancelled && isPowerSyncReplicaDiagnosticsEnabled()) {
          void runPowerSyncReplicaDiagnostics(db).then((diag) => {
            console.info(
              '[PowerSyncReplicaDiag:after_connect]',
              JSON.stringify(diag),
            );
          });
          firstSyncWatchdogId = setTimeout(() => {
            if (cancelled || reachedAfterWaitForFirstSync) {
              return;
            }
            console.warn(
              '[PowerSyncReplicaDiag:watchdog_first_sync_pending_30s]',
              'waitForFirstSync still pending after 30s. Inspect prior [PowerSyncReplicaDiag:fetch_credentials] and [PowerSyncReplicaDiag:status] lines for downloadError / hasSynced. Verify EXPO_PUBLIC_POWERSYNC_URL, PowerSync JWT/JWKS vs Supabase project, Dashboard sync streams, and network reachability.',
            );
            console.info(
              '[PowerSyncReplicaDiag:watchdog_status]',
              JSON.stringify(
                summarizePowerSyncSyncStatusForLog(db.currentStatus),
              ),
            );
            void runPowerSyncReplicaDiagnostics(db).then((diag) => {
              console.info(
                '[PowerSyncReplicaDiag:watchdog_counts]',
                JSON.stringify(diag),
              );
            });
          }, 30_000);
        }
        if (!cancelled && isPowerSyncReplicaDiagnosticsEnabled()) {
          disposeSyncStatusDiag = registerPowerSyncSyncStatusDiagnostics(
            db,
            (jsonLine) => {
              console.info('[PowerSyncReplicaDiag:status]', jsonLine);
            },
          );
          console.info(
            '[PowerSyncReplicaDiag:status_snapshot_after_connect]',
            JSON.stringify(
              summarizePowerSyncSyncStatusForLog(db.currentStatus),
            ),
          );
        }
        await db.waitForFirstSync(ac.signal);
        reachedAfterWaitForFirstSync = true;
        clearFirstSyncWatchdog();
        if (!cancelled) {
          setFirstSyncCompleted(true);
          recordFirstSyncLanded();
        }
        if (!cancelled && isPowerSyncReplicaDiagnosticsEnabled()) {
          void runPowerSyncReplicaDiagnostics(db).then((diag) => {
            console.info(
              '[PowerSyncReplicaDiag:after_first_sync]',
              JSON.stringify(diag),
            );
          });
        }
      } catch (e) {
        clearFirstSyncWatchdog();
        if (!cancelled && !isAbortError(e)) {
          syncCaughtMessage =
            e instanceof Error ? e.message : JSON.stringify(e);
          setSyncError(e instanceof Error ? e : new Error(String(e)));
          if (isPowerSyncReplicaDiagnosticsEnabled()) {
            console.warn(
              '[PowerSyncReplicaDiag:sync_caught_error]',
              syncCaughtMessage,
            );
            void runPowerSyncReplicaDiagnostics(db).then((diag) => {
              console.info(
                '[PowerSyncReplicaDiag:on_error_counts]',
                JSON.stringify(diag),
              );
            });
          }
        }
      } finally {
        clearFirstSyncWatchdog();
        disposeSyncStatusDiag?.();
        disposeSyncStatusDiag = undefined;
        if (!cancelled && isPowerSyncReplicaDiagnosticsEnabled()) {
          void runPowerSyncReplicaDiagnostics(db).then((diag) => {
            console.info(
              '[PowerSyncReplicaDiag:sync_attempt_finished]',
              JSON.stringify({
                reachedAfterWaitForFirstSync,
                syncCaughtMessage: syncCaughtMessage ?? null,
                diag,
              }),
            );
          });
        }
        if (!cancelled) {
          setSyncConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
      disposeSyncStatusDiag?.();
      disposeSyncStatusDiag = undefined;
      // Sign-out: `disconnectAndClear` runs in the following effect — do not disconnect here.
      if (!sessionRef.current?.access_token) {
        return;
      }
      // PowerSync URL removed while signed in — tear down sync; DB stays open for local reads.
      if (!urlConfiguredRef.current) {
        void db.disconnect();
        return;
      }
      // Still signed in with a configured URL: the next `connect()` already calls
      // `ConnectionManager.disconnectInternal()` before reconnecting. Calling `disconnect()` here
      // races with in-flight `connect()` / `performDisconnect()` and spams "Trying to close for the second time".
    };
  }, [
    buildConnector,
    db,
    hasAuthSession,
    powerSyncUrl,
    recordFirstSyncLanded,
    urlConfigured,
  ]);

  useEffect(() => {
    if (hasAuthSession) {
      return;
    }
    if (!db) {
      return;
    }

    void (async () => {
      try {
        await db.disconnectAndClear();
      } catch (e) {
        console.warn('[PowerSync] disconnectAndClear after sign-out', e);
      } finally {
        setFirstSyncCompleted(false);
        setLocalSqliteInitialized(false);
        setFirstSyncLandedOnDevice(false);
        setFirstSyncLandingHydrated(true);
        setSyncError(null);
      }
    })();
  }, [hasAuthSession, db]);

  const bridgeValue = useMemo(
    (): PowerSyncBridgeState => ({
      syncChromeEnabled: urlConfigured && hasAuthSession,
      powerSyncUrlConfigured: urlConfigured,
      database: db,
      firstSyncCompleted,
      localSqliteInitialized,
      syncConnecting,
      syncError,
      firstSyncLandedOnDevice,
      firstSyncLandingHydrated,
    }),
    [
      db,
      firstSyncCompleted,
      firstSyncLandedOnDevice,
      firstSyncLandingHydrated,
      hasAuthSession,
      localSqliteInitialized,
      syncConnecting,
      syncError,
      urlConfigured,
    ],
  );

  /**
   * Keep the module-level offline read gate aligned with {@link bridgeValue} during render (not in
   * a `useEffect`). Tab screens often load on `useFocusEffect`, which can run in the same commit
   * before parent effects flush; a deferred snapshot made `getPowerSyncDatabaseForOfflineReads()`
   * falsely `null` so preset/template lists skipped the SQLite fallback while the UI bridge was
   * already ready.
   */
  setPowerSyncOfflineReadBridgeSnapshot({
    database: bridgeValue.database,
    firstSyncCompleted: bridgeValue.firstSyncCompleted,
    localSqliteInitialized: bridgeValue.localSqliteInitialized,
    powerSyncUrlConfigured: bridgeValue.powerSyncUrlConfigured,
    firstSyncLandingHydrated: bridgeValue.firstSyncLandingHydrated,
    firstSyncLandedOnDevice: bridgeValue.firstSyncLandedOnDevice,
  });

  // PowerSync typings omit `null`, but hooks treat a missing DB like "not configured" at runtime.
  return (
    <PowerSyncContext.Provider
      value={db as unknown as AbstractPowerSyncDatabase}
    >
      <PowerSyncBridgeContext.Provider value={bridgeValue}>
        <PowerSyncManualResyncContext.Provider value={manualResyncContextValue}>
          {children}
        </PowerSyncManualResyncContext.Provider>
      </PowerSyncBridgeContext.Provider>
    </PowerSyncContext.Provider>
  );
}
