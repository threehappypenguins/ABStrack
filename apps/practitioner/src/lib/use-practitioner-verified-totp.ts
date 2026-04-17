'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export type UsePractitionerVerifiedTotpCountResult = {
  verifiedTotpCount: number;
  loading: boolean;
  error: Error | null;
  /** Reloads factor list after enrollment or session changes. */
  refresh: () => Promise<void>;
};

type FactorsPhase = 'idle' | 'loading' | 'ready';

/**
 * Loads verified TOTP factor count for practitioner MFA gating. No-ops when `enabled` is false.
 *
 * When `enabled` flips from false to true, loading is set synchronously (via state adjustment
 * during render) so consumers do not briefly see a settled count of 0 before the first fetch.
 *
 * @param enabled - When false, clears counts and skips network calls (e.g. non-practitioner gates).
 * @returns Verified factor count, loading and error state, and a manual refresh.
 */
export function usePractitionerVerifiedTotpCount(
  enabled: boolean,
): UsePractitionerVerifiedTotpCountResult {
  const [verifiedTotpCount, setVerifiedTotpCount] = useState(0);
  const [prevEnabled, setPrevEnabled] = useState(enabled);
  const [phase, setPhase] = useState<FactorsPhase>(() =>
    enabled ? 'loading' : 'idle',
  );
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  if (enabled !== prevEnabled) {
    setPrevEnabled(enabled);
    if (!enabled) {
      setPhase('idle');
      setVerifiedTotpCount(0);
      setError(null);
    } else {
      setPhase('loading');
      setVerifiedTotpCount(0);
      setError(null);
    }
  }

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const loadFactors = useCallback(async (): Promise<number> => {
    const result = await supabase.auth.mfa.listFactors();
    if (result.error) {
      throw result.error;
    }
    return result.data.totp.filter((f) => f.status === 'verified').length;
  }, [supabase]);

  const refresh = useCallback((): Promise<void> => {
    if (!enabled) {
      return Promise.resolve();
    }
    setError(null);
    setPhase('loading');
    return Promise.resolve();
  }, [enabled]);

  useEffect(() => {
    if (!enabled || phase !== 'loading') {
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const n = await loadFactors();
        if (!cancelled && isMountedRef.current) {
          setVerifiedTotpCount(n);
          setPhase('ready');
        }
      } catch (e) {
        if (!cancelled && isMountedRef.current) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setPhase('ready');
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, phase, loadFactors]);

  const loading = enabled && phase === 'loading';

  return { verifiedTotpCount, loading, error, refresh };
}
