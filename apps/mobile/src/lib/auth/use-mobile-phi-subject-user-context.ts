import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppRole } from '@abstrack/types';

import { useMobileAuthUserId } from './use-mobile-auth-user-id';
import { usePowerSyncBridgeState } from '../powersync/PowerSyncSessionBridge';
import { resolveMobilePhiSubjectUserContext } from '../phi-subject/resolve-mobile-phi-subject-user-context';

export type MobilePhiSubjectUserContextState = {
  /** Same as {@link useMobileAuthUserId} while resolving. */
  loading: boolean;
  /** User-facing resolve failure (e.g. caretaker not linked). */
  errorMessage: string | null;
  /** Supabase auth user id. */
  authUserId: string | null;
  /** Patient id for PHI rows (same as `authUserId` for patients). */
  phiSubjectUserId: string | null;
  profileAppRole: AppRole | null;
  /** Re-runs resolution (e.g. after first PowerSync sync lands `caretaker_access`). */
  refresh: () => void;
};

/**
 * Resolves the patient user id used for episode / marker / food PHI (`phiSubjectUserId`) vs the
 * signed-in auth id (`authUserId`). Caretakers use the linked patient from active `caretaker_access`.
 *
 * In-flight {@link resolveMobilePhiSubjectUserContext} results are ignored after unmount or when
 * `authUserId` / replica readiness (`database` + `localSqliteInitialized`) / first-sync completion
 * change, by bumping a generation counter so async completion does not call `setState` on an
 * unmounted consumer. Bridge fields such as `syncConnecting` are intentionally excluded from the
 * resolve callback deps so unrelated PowerSync UI state does not re-trigger network resolution.
 *
 * @returns Loading and error state plus ids for Home, Manage, and episode flows.
 */
export function useMobilePhiSubjectUserContext(): MobilePhiSubjectUserContextState {
  const authUserId = useMobileAuthUserId();
  const psBridge = usePowerSyncBridgeState();
  const firstSyncCompleted = psBridge.firstSyncCompleted;
  const dbForPhi = useMemo(() => {
    return psBridge.database != null && psBridge.localSqliteInitialized
      ? psBridge.database
      : null;
  }, [psBridge.database, psBridge.localSqliteInitialized]);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [phiSubjectUserId, setPhiSubjectUserId] = useState<string | null>(null);
  const [profileAppRole, setProfileAppRole] = useState<AppRole | null>(null);
  const genRef = useRef(0);

  const runResolve = useCallback(async () => {
    const gen = ++genRef.current;
    if (authUserId == null || authUserId.trim() === '') {
      setLoading(false);
      setErrorMessage(null);
      setPhiSubjectUserId(null);
      setProfileAppRole(null);
      return;
    }
    setLoading(true);
    setErrorMessage(null);
    const result = await resolveMobilePhiSubjectUserContext({
      powerSyncDatabase: dbForPhi,
    });
    if (gen !== genRef.current) {
      return;
    }
    setLoading(false);
    if (!result.ok) {
      setPhiSubjectUserId(null);
      setProfileAppRole(null);
      setErrorMessage(result.error.message);
      return;
    }
    if (result.data == null) {
      setPhiSubjectUserId(null);
      setProfileAppRole(null);
      setErrorMessage(null);
      return;
    }
    setPhiSubjectUserId(result.data.phiSubjectUserId);
    setProfileAppRole(result.data.profileAppRole);
    setErrorMessage(null);
  }, [authUserId, dbForPhi]);

  useEffect(() => {
    void runResolve();
    return () => {
      genRef.current += 1;
    };
  }, [runResolve]);

  const firstSyncHandledRef = useRef(false);
  useEffect(() => {
    if (!firstSyncCompleted) {
      firstSyncHandledRef.current = false;
    } else if (!firstSyncHandledRef.current) {
      firstSyncHandledRef.current = true;
      void runResolve();
    }
    return () => {
      genRef.current += 1;
    };
  }, [firstSyncCompleted, runResolve]);

  const refresh = useCallback(() => {
    void runResolve();
  }, [runResolve]);

  return {
    loading,
    errorMessage,
    authUserId,
    phiSubjectUserId,
    profileAppRole,
    refresh,
  };
}
