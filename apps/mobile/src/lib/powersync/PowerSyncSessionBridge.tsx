import type { Session } from '@abstrack/supabase';
import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { AbstractPowerSyncDatabase } from '@powersync/common';
import { PowerSyncContext } from '@powersync/react';
import type { PowerSyncDatabase } from '@powersync/react-native';

import { getMobileSupabaseClient } from '../supabase-wiring';
import { createSupabaseJwtPowerSyncConnector } from './supabase-jwt-connector';
import { getMobilePowerSyncUrl } from './powersync-env';
import { getOrCreateDeviceSqlcipherKey } from './powersync-sqlcipher-key';
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
};

const defaultBridgeState: PowerSyncBridgeState = {
  powerSyncUrlConfigured: false,
  database: null,
  firstSyncCompleted: false,
  localSqliteInitialized: false,
  syncConnecting: false,
  syncError: null,
};

const PowerSyncBridgeContext =
  createContext<PowerSyncBridgeState>(defaultBridgeState);

/**
 * @returns PowerSync lifecycle flags for gating SQLite-backed reads.
 */
export function usePowerSyncBridgeState(): PowerSyncBridgeState {
  return useContext(PowerSyncBridgeContext);
}

/**
 * Whether preset/template list screens may issue read-only SQL against the encrypted replica.
 * Uses {@link PowerSyncBridgeState.localSqliteInitialized} so **cold start offline** still reads
 * rows persisted from an earlier online session when {@link PowerSyncBridgeState.firstSyncCompleted}
 * is still false (because {@link PowerSyncDatabase.waitForFirstSync} cannot finish without network).
 *
 * @param bridge - Latest {@link usePowerSyncBridgeState} value.
 */
export function powerSyncOfflineReplicaReadsEnabled(
  bridge: PowerSyncBridgeState,
): boolean {
  return Boolean(
    bridge.powerSyncUrlConfigured &&
      bridge.database &&
      (bridge.firstSyncCompleted || bridge.localSqliteInitialized),
  );
}

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
  const [syncConnecting, setSyncConnecting] = useState(false);
  const [syncError, setSyncError] = useState<Error | null>(null);

  const mobileSupabase = useMemo(() => getMobileSupabaseClient(), []);

  /** Latest session for connect-effect cleanup (skip redundant disconnect on sign-out). */
  const sessionRef = useRef(session);
  sessionRef.current = session;

  /** Latest URL flag: cleanup disconnects when replication is disabled while still signed in. */
  const urlConfiguredRef = useRef(urlConfigured);
  urlConfiguredRef.current = urlConfigured;

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

    const baseConnector = createSupabaseJwtPowerSyncConnector({
      powerSyncUrl,
      getSession: async () => {
        const { data } = await mobileSupabase.auth.getSession();
        const next = data.session;
        if (!next?.access_token) {
          return null;
        }
        return { access_token: next.access_token };
      },
      getSupabaseClient: () => getMobileSupabaseClient(),
    });
    const connector = isPowerSyncReplicaDiagnosticsEnabled()
      ? wrapPowerSyncBackendConnectorWithFetchDiagnostics(
          baseConnector,
          (jsonLine) => {
            console.info('[PowerSyncReplicaDiag:fetch_credentials]', jsonLine);
          },
        )
      : baseConnector;

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
  }, [db, hasAuthSession, mobileSupabase, powerSyncUrl, urlConfigured]);

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
        setSyncError(null);
      }
    })();
  }, [hasAuthSession, db]);

  const bridgeValue = useMemo(
    (): PowerSyncBridgeState => ({
      powerSyncUrlConfigured: urlConfigured,
      database: db,
      firstSyncCompleted,
      localSqliteInitialized,
      syncConnecting,
      syncError,
    }),
    [
      db,
      firstSyncCompleted,
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
  });

  // PowerSync typings omit `null`, but hooks treat a missing DB like "not configured" at runtime.
  return (
    <PowerSyncContext.Provider
      value={db as unknown as AbstractPowerSyncDatabase}
    >
      <PowerSyncBridgeContext.Provider value={bridgeValue}>
        {children}
      </PowerSyncBridgeContext.Provider>
    </PowerSyncContext.Provider>
  );
}
