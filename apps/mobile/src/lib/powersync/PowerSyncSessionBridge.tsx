import type { Session } from '@abstrack/supabase';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
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
  clearPowerSyncFirstSyncLandedForUser,
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
  /**
   * Set when connect or first sync fails, or when sign-out replica cleanup
   * (`disconnectAndClear` / landing storage) fails — in the latter case the user is signed out
   * but local PHI may still exist until cleanup succeeds. Landing clear uses delete with an
   * overwrite fallback so a cleared empty replica is not paired with a stale “landed” flag.
   */
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
   *
   * @returns `true` when `waitForFirstSync` completed on this attempt; `false` when skipped, the
   * session was lost mid-flight, first sync wait timed out, or an error was recorded.
   */
  requestManualResync: () => Promise<boolean>;
  /** True while {@link requestManualResync} is running. */
  manualResyncBusy: boolean;
};

const defaultManualResync: PowerSyncManualResyncContextValue = {
  requestManualResync: async () => false,
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
 * **Logout / account switch:** When `session` loses **identity** (`session.user`), the bridge clears
 * the prior user’s first-sync landing marker and runs `disconnectAndClear` on the shared DB. If
 * another account signs in while that async cleanup is still running, cleanup **still** completes
 * the wipe when the current `session.user.id` differs from the user being cleared (so the new
 * account never reads the previous user’s replica). A direct **A→B** switch (without a `null`
 * session frame) runs the same wipe via a dedicated `session.user.id` transition effect.
 * A persisted session with an **expired** JWT may have
 * `access_token: ''` while `user` remains — that is still signed-in for offline UI; the connector
 * withholds the bearer until refresh. `fetchCredentials` returns `null` without a live token;
 * `connect` / `waitForFirstSync` run only when `access_token` is non-empty. When the token is
 * redacted after a live connection, the bridge calls `disconnect()` (not `disconnectAndClear`) so
 * the old websocket does not keep syncing PHI with a stale bearer.
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
   * Persisted Supabase user is present (including identity-only sessions where the access JWT is
   * redacted offline). Drives DB open, sync chrome, and **not** sign-out replica cleanup.
   */
  const hasAuthIdentity = Boolean(session?.user?.id);

  /**
   * Non-empty access token — drives PowerSync `connect` / `waitForFirstSync` and manual resync so
   * token churn does not constantly reconnect the stream (connector reads the latest JWT).
   */
  const hasAuthSession = Boolean(session?.access_token);

  /**
   * Last signed-in `session.user.id` so we can clear persisted first-sync landing on logout after
   * `session` is already null (SecureStore must align with `disconnectAndClear`).
   */
  const lastSignedInUserIdRef = useRef<string | null>(null);
  useEffect(() => {
    const uid = session?.user?.id;
    if (uid) {
      lastSignedInUserIdRef.current = uid;
    }
  }, [session?.user?.id]);

  /**
   * Tracks prior `session.user.id` to detect in-session account switches (no `null` frame).
   * Updated after a successful wipe or on effect cleanup to match {@link sessionRef}.
   */
  const accountSwitchPrevUserIdRef = useRef<string | null>(null);

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

  /**
   * Persists “first sync landed” for the given user. When `userIdAtObservation` is set, only marks
   * if `sessionRef` still refers to that user (avoids wrong-account storage when the auth
   * user changes between the sync milestone and a deferred microtask).
   *
   * @param userIdAtObservation - User id captured when first sync became trusted; omit to use the
   *   current session only (no mismatch guard).
   */
  const recordFirstSyncLanded = useCallback(
    (userIdAtObservation?: string | null) => {
      const currentUserId = sessionRef.current?.user?.id ?? null;
      const userId = userIdAtObservation ?? currentUserId;
      if (!userId) {
        return;
      }
      if (
        userIdAtObservation != null &&
        userIdAtObservation !== '' &&
        currentUserId !== userIdAtObservation
      ) {
        return;
      }
      setFirstSyncLandedOnDevice(true);
      void markPowerSyncFirstSyncLandedForUser(userId);
    },
    [],
  );

  /**
   * Before paint (and before other `useEffect` hooks), quarantine offline-read trust when the
   * auth user id changes while the DB handle already exists — avoids a one-frame read of the prior
   * user’s replica while the async wipe is scheduled.
   */
  useLayoutEffect(() => {
    const next = session?.user?.id ?? null;
    const prev = accountSwitchPrevUserIdRef.current;
    if (db && urlConfigured && prev != null && next != null && prev !== next) {
      setFirstSyncCompleted(false);
      setFirstSyncLandedOnDevice(false);
      setFirstSyncLandingHydrated(false);
    }
  }, [session?.user?.id, db, urlConfigured]);

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

  const requestManualResync = useCallback(async (): Promise<boolean> => {
    if (!db || !hasAuthSession || !urlConfigured) {
      return false;
    }
    if (manualResyncBusyRef.current) {
      return false;
    }
    manualResyncBusyRef.current = true;
    setManualResyncBusy(true);
    let outcome = false;
    try {
      const connector = buildConnector();
      await db.disconnect();
      if (!sessionRef.current?.access_token) {
        return false;
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
          outcome = true;
          const userIdAfterWait = sessionRef.current?.user?.id ?? null;
          setFirstSyncCompleted(true);
          if (userIdAfterWait) {
            recordFirstSyncLanded(userIdAfterWait);
          }
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
    return outcome;
  }, [
    buildConnector,
    db,
    hasAuthSession,
    recordFirstSyncLanded,
    urlConfigured,
  ]);

  /**
   * If the stream recovers after `waitForFirstSync` rejected (e.g. offline timeout), PowerSync can
   * later report `hasSynced` while {@link syncError} still reflects the old failure. Only clear
   * {@link syncError} and mark {@link firstSyncCompleted} / persisted landing once
   * **`status.hasSynced === true`** so Home/Manage do not trust the mirror before first sync is
   * actually complete, and offline replica reads are not gated forever without another reconnect.
   */
  useEffect(() => {
    if (!db || !hasAuthIdentity) {
      return;
    }
    return db.registerListener({
      statusChanged: (status) => {
        const df = status.dataFlowStatus;
        const transportOk =
          status.connected &&
          !status.connecting &&
          !df?.uploadError &&
          !df?.downloadError;
        const firstSyncTrusted = transportOk && status.hasSynced === true;
        if (firstSyncTrusted) {
          const userIdAtTrusted = sessionRef.current?.user?.id ?? null;
          setSyncError((prev) => (prev ? null : prev));
          setFirstSyncCompleted((done) => {
            if (done) {
              return done;
            }
            if (!userIdAtTrusted) {
              return true;
            }
            queueMicrotask(() => {
              recordFirstSyncLanded(userIdAtTrusted);
            });
            return true;
          });
        }
      },
    });
  }, [db, hasAuthIdentity, recordFirstSyncLanded]);

  const manualResyncContextValue = useMemo(
    (): PowerSyncManualResyncContextValue => ({
      requestManualResync,
      manualResyncBusy,
    }),
    [manualResyncBusy, requestManualResync],
  );

  useEffect(() => {
    if (!hasAuthIdentity || !urlConfigured) {
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
  }, [hasAuthIdentity, urlConfigured]);

  useEffect(() => {
    if (!db || !hasAuthIdentity || !urlConfigured) {
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
        if (!sessionRef.current?.access_token) {
          if (!cancelled) {
            setSyncConnecting(false);
          }
          return;
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
          const userIdAfterWait = sessionRef.current?.user?.id ?? null;
          setFirstSyncCompleted(true);
          if (userIdAfterWait) {
            recordFirstSyncLanded(userIdAfterWait);
          }
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
      // No bearer: tear down the stream if identity remains (redacted/offline token). Full sign-out
      // (`user` gone) uses `disconnectAndClear` in a separate effect — skip `disconnect()` there
      // so we do not race replica wipe.
      if (!sessionRef.current?.access_token) {
        if (sessionRef.current?.user?.id) {
          void db.disconnect();
        }
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
    hasAuthIdentity,
    hasAuthSession,
    powerSyncUrl,
    recordFirstSyncLanded,
    session?.user?.id,
    urlConfigured,
  ]);

  /**
   * In-session account switch (user A → user B without `session.user` going null): wipe the shared
   * replica immediately so B cannot read A’s SQLite mirror. Quarantines offline-read flags until
   * first-sync landing is reloaded for B.
   */
  useEffect(() => {
    let cancelled = false;
    const next = session?.user?.id ?? null;
    const prev = accountSwitchPrevUserIdRef.current;

    const syncPrevRefToCurrentSession = () => {
      accountSwitchPrevUserIdRef.current = sessionRef.current?.user?.id ?? null;
    };

    if (
      !db ||
      !urlConfigured ||
      prev == null ||
      next == null ||
      prev === next
    ) {
      syncPrevRefToCurrentSession();
      return () => {
        cancelled = true;
        syncPrevRefToCurrentSession();
      };
    }

    void (async () => {
      const shouldContinueReplicaWipeForLandingUser = () => {
        if (cancelled) {
          return false;
        }
        const uid = sessionRef.current?.user?.id ?? null;
        if (!uid) {
          return true;
        }
        return uid !== prev;
      };

      const failures: unknown[] = [];
      try {
        await clearPowerSyncFirstSyncLandedForUser(prev);
      } catch (e) {
        if (!shouldContinueReplicaWipeForLandingUser()) {
          return;
        }
        failures.push(e);
        console.warn(
          '[PowerSync] account-switch prior-user landing clear failed',
          e,
        );
      }
      if (!shouldContinueReplicaWipeForLandingUser()) {
        return;
      }
      try {
        await db.disconnectAndClear();
      } catch (e) {
        if (!shouldContinueReplicaWipeForLandingUser()) {
          return;
        }
        failures.push(e);
        console.warn('[PowerSync] account-switch replica wipe failed', e);
      }
      if (!shouldContinueReplicaWipeForLandingUser()) {
        return;
      }

      setFirstSyncCompleted(false);
      setLocalSqliteInitialized(false);
      setSyncError(null);

      const uidAfter = sessionRef.current?.user?.id;
      if (!uidAfter) {
        setFirstSyncLandedOnDevice(false);
        setFirstSyncLandingHydrated(true);
      } else {
        setFirstSyncLandingHydrated(false);
        try {
          const landed = await getPowerSyncFirstSyncLandedForUser(uidAfter);
          if (!shouldContinueReplicaWipeForLandingUser()) {
            return;
          }
          setFirstSyncLandedOnDevice(landed);
        } catch (e) {
          console.warn(
            '[PowerSync] account-switch first-sync landing reload failed',
            e,
          );
          if (shouldContinueReplicaWipeForLandingUser()) {
            setFirstSyncLandedOnDevice(false);
          }
        } finally {
          if (shouldContinueReplicaWipeForLandingUser()) {
            setFirstSyncLandingHydrated(true);
          }
        }
      }

      const cleanupError =
        failures.length === 0
          ? null
          : new Error(
              [
                'Account switch could not finish clearing the prior user’s encrypted copy on this device.',
                `Detail: ${failures
                  .map((f) => (f instanceof Error ? f.message : String(f)))
                  .join('; ')}`,
              ].join(' '),
            );
      if (cleanupError && shouldContinueReplicaWipeForLandingUser()) {
        setSyncError(cleanupError);
      }

      accountSwitchPrevUserIdRef.current = next;
    })();

    return () => {
      cancelled = true;
      syncPrevRefToCurrentSession();
    };
  }, [session?.user?.id, db, urlConfigured]);

  /**
   * Sign-out replica wipe: runs when **identity** is gone (`session.user`), not merely when the
   * access JWT is empty. If another account signs in while this async cleanup runs, the wipe still
   * completes when the current `session.user.id` differs from the user being cleared (same shared
   * DB file for all accounts).
   */
  useEffect(() => {
    if (hasAuthIdentity) {
      return;
    }
    let cancelled = false;
    const landingUserId = lastSignedInUserIdRef.current;
    lastSignedInUserIdRef.current = null;

    const shouldFinishLandingUserReplicaWipe = () => {
      if (cancelled) {
        return false;
      }
      const uid = sessionRef.current?.user?.id ?? null;
      if (!uid) {
        return true;
      }
      return uid !== landingUserId;
    };

    void (async () => {
      const failures: unknown[] = [];
      if (landingUserId) {
        try {
          await clearPowerSyncFirstSyncLandedForUser(landingUserId);
        } catch (e) {
          if (!shouldFinishLandingUserReplicaWipe()) {
            return;
          }
          failures.push(e);
          console.warn(
            '[PowerSync] sign-out first-sync landing clear failed',
            e,
          );
        }
      }
      if (!shouldFinishLandingUserReplicaWipe()) {
        return;
      }
      if (db) {
        try {
          await db.disconnectAndClear();
        } catch (e) {
          if (!shouldFinishLandingUserReplicaWipe()) {
            return;
          }
          failures.push(e);
          console.warn('[PowerSync] sign-out replica cleanup failed', e);
        }
      }
      if (!shouldFinishLandingUserReplicaWipe()) {
        return;
      }

      const cleanupError =
        failures.length === 0
          ? null
          : new Error(
              [
                'Sign-out could not finish clearing the encrypted health copy on this device.',
                'You are signed out; local data may remain until this succeeds or you reinstall the app.',
                `Detail: ${failures
                  .map((f) => (f instanceof Error ? f.message : String(f)))
                  .join('; ')}`,
              ].join(' '),
            );

      setFirstSyncCompleted(false);
      setLocalSqliteInitialized(false);

      const uidAfter = sessionRef.current?.user?.id;
      if (!uidAfter) {
        setFirstSyncLandedOnDevice(false);
        setFirstSyncLandingHydrated(true);
        setSyncError(cleanupError);
      } else {
        setFirstSyncLandingHydrated(false);
        try {
          const landed = await getPowerSyncFirstSyncLandedForUser(uidAfter);
          if (!shouldFinishLandingUserReplicaWipe()) {
            return;
          }
          setFirstSyncLandedOnDevice(landed);
        } catch (e) {
          console.warn(
            '[PowerSync] sign-out interrupted: first-sync landing reload failed',
            e,
          );
          if (shouldFinishLandingUserReplicaWipe()) {
            setFirstSyncLandedOnDevice(false);
          }
        } finally {
          if (shouldFinishLandingUserReplicaWipe()) {
            setFirstSyncLandingHydrated(true);
          }
        }
        setSyncError(cleanupError);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hasAuthIdentity, db]);

  const bridgeValue = useMemo(
    (): PowerSyncBridgeState => ({
      syncChromeEnabled: urlConfigured && hasAuthIdentity,
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
      hasAuthIdentity,
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
