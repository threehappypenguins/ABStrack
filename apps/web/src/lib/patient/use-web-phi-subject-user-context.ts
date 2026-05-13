'use client';

import type { AppRole } from '@abstrack/types';
import { resolvePhiSubjectUserContextFromSupabase } from '@abstrack/supabase';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '@/lib/auth-provider';
import { createBrowserClient } from '@/lib/supabase/browser-client';

export type WebPhiSubjectUserContextState = {
  authUserId: string | null;
  phiSubjectUserId: string | null;
  profileAppRole: AppRole | null;
  loading: boolean;
  errorMessage: string | null;
  refresh: () => void;
};

/**
 * Resolves the patient id used for PHI reads/writes on user web (`phiSubjectUserId`) vs the
 * signed-in auth id. Caretakers use the linked patient from active `caretaker_access`.
 *
 * In-flight resolves are dropped after unmount or when `authUserId` / auth loading changes by
 * bumping an internal generation counter so async completion does not call `setState` on an
 * unmounted consumer. When starting a resolve for a non-null `authUserId`, `phiSubjectUserId` and
 * `profileAppRole` state are cleared first so consumers that do not gate every read on `loading`
 * cannot briefly use a prior account’s PHI scope.
 *
 * @returns Async-resolved ids plus loading and error state for episode, manage, and preset flows.
 */
export function useWebPhiSubjectUserContext(): WebPhiSubjectUserContextState {
  const { session, loading: authLoading } = useAuth();
  const authUserId =
    session?.user?.id != null && session.user.id !== ''
      ? session.user.id
      : null;
  const [phiSubjectUserId, setPhiSubjectUserId] = useState<string | null>(null);
  const [profileAppRole, setProfileAppRole] = useState<AppRole | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [resolving, setResolving] = useState(false);
  const genRef = useRef(0);

  const run = useCallback(async () => {
    const gen = ++genRef.current;
    if (authUserId == null) {
      setPhiSubjectUserId(null);
      setProfileAppRole(null);
      setErrorMessage(null);
      setResolving(false);
      return;
    }
    setPhiSubjectUserId(null);
    setProfileAppRole(null);
    setErrorMessage(null);
    setResolving(true);
    const supabase = createBrowserClient();
    const result = await resolvePhiSubjectUserContextFromSupabase(
      supabase,
      authUserId,
    );
    if (gen !== genRef.current) {
      return;
    }
    setResolving(false);
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
  }, [authUserId]);

  useEffect(() => {
    if (!authLoading) {
      void run();
    }
    return () => {
      genRef.current += 1;
    };
  }, [authLoading, run]);

  const refresh = useCallback(() => {
    void run();
  }, [run]);

  return {
    authUserId,
    phiSubjectUserId,
    profileAppRole,
    loading: authLoading || resolving,
    errorMessage,
    refresh,
  };
}
