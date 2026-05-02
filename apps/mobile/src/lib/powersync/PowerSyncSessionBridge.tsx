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
  /** True while `init` / `connect` / first sync are in flight. */
  syncConnecting: boolean;
  /** Set when connect or first sync fails (logged-out cleanup errors are ignored). */
  syncError: Error | null;
};

const defaultBridgeState: PowerSyncBridgeState = {
  powerSyncUrlConfigured: false,
  database: null,
  firstSyncCompleted: false,
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

    const connector = createSupabaseJwtPowerSyncConnector({
      powerSyncUrl,
      getSession: async () => {
        const { data } = await mobileSupabase.auth.getSession();
        const next = data.session;
        if (!next?.access_token) {
          return null;
        }
        return { access_token: next.access_token };
      },
    });

    const ac = new AbortController();
    let cancelled = false;

    void (async () => {
      try {
        setSyncError(null);
        setSyncConnecting(true);
        setFirstSyncCompleted(false);
        await db.init();
        await db.connect(connector);
        await db.waitForFirstSync(ac.signal);
        if (!cancelled) {
          setFirstSyncCompleted(true);
        }
      } catch (e) {
        if (!cancelled && !isAbortError(e)) {
          setSyncError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled) {
          setSyncConnecting(false);
        }
      }
    })();

    return () => {
      cancelled = true;
      ac.abort();
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
        setSyncError(null);
      }
    })();
  }, [hasAuthSession, db]);

  const bridgeValue = useMemo(
    (): PowerSyncBridgeState => ({
      powerSyncUrlConfigured: urlConfigured,
      database: db,
      firstSyncCompleted,
      syncConnecting,
      syncError,
    }),
    [db, firstSyncCompleted, syncConnecting, syncError, urlConfigured],
  );

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
