import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { AppRole } from '@abstrack/types';

import { useMobileAuthUserId } from './use-mobile-auth-user-id';
import { usePowerSyncBridgeState } from '../powersync/PowerSyncSessionBridge';
import { resolveMobilePhiSubjectUserContext } from '../phi-subject/resolve-mobile-phi-subject-user-context';

export type MobilePhiSubjectUserContextState = {
  /** True while resolving PHI scope (includes awaiting {@link resolveMobilePhiSubjectUserContext}). */
  loading: boolean;
  /** User-facing resolve failure (e.g. caretaker not linked). */
  errorMessage: string | null;
  /**
   * Same as {@link useMobileAuthUserId}; may remain null briefly on cold start while PHI scope
   * still resolves via persisted session recovery inside {@link resolveMobilePhiSubjectUserContext}.
   */
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
 * In-flight {@link resolveMobilePhiSubjectUserContext} results are ignored when a **new** resolve
 * starts (each `runResolve` call increments a generation counter first) or when the hook
 * **unmounts** (a final increment drops any still-pending completion). Replica readiness
 * (`database` + `localSqliteInitialized`) and `authUserId` changes recreate `runResolve` and
 * re-run the primary effect, which invokes it again; the first-sync effect may invoke it once when
 * `firstSyncCompleted` becomes true. Each new resolve clears `phiSubjectUserId` and `profileAppRole` before
 * awaiting the resolver so consumers that do not gate every read on `loading` cannot briefly use a
 * stale PHI subject after an account switch or replica re-scope. Resolution still runs when `authUserId` is null: on cold starts where
 * {@link useMobileAuthUserId} has not recovered yet, {@link resolveMobilePhiSubjectUserContext}
 * may still read a persisted auth id (the same path as inside that resolver), so those sessions are
 * not treated as signed-out for PHI scope. Bridge fields such as `syncConnecting` are intentionally
 * excluded from the resolve callback deps so unrelated PowerSync UI state does not re-trigger
 * network resolution.
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
    setLoading(true);
    setErrorMessage(null);
    setPhiSubjectUserId(null);
    setProfileAppRole(null);
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
  }, [dbForPhi]);

  /**
   * Invalidate in-flight resolves only on real unmount. Do not bump `genRef` from other effect
   * cleanups when `runResolve` identity changes: `runResolve` already increments the generation at
   * the start of each call, so the previous async completion is dropped without an extra cleanup
   * bump (which would also have raced the first-sync effect's overlapping resolve).
   */
  useEffect(() => {
    return () => {
      genRef.current += 1;
    };
  }, []);

  useEffect(() => {
    void runResolve();
  }, [runResolve]);

  const firstSyncHandledRef = useRef(false);
  useEffect(() => {
    if (!firstSyncCompleted) {
      firstSyncHandledRef.current = false;
    } else if (!firstSyncHandledRef.current) {
      firstSyncHandledRef.current = true;
      void runResolve();
    }
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
