'use client';

import { getSupabaseBrowserClient } from '@abstrack/supabase/browser';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

export type UsePractitionerVerifiedTotpCountResult = {
  verifiedTotpCount: number;
  loading: boolean;
  error: Error | null;
  /**
   * Reloads the verified TOTP factor list. The returned promise settles when that request
   * finishes (success or failure).
   */
  refresh: () => Promise<void>;
};

/**
 * Loads verified TOTP factor count for practitioner MFA gating. No-ops when `enabled` is false.
 *
 * When `enabled` flips from false to true, `useLayoutEffect` sets a pending flag before paint so
 * consumers do not briefly see a settled count of 0 before the first fetch.
 *
 * @param enabled - When false, clears counts and skips network calls (e.g. non-practitioner gates).
 * @returns Verified factor count, loading and error state, and a manual refresh.
 */
export function usePractitionerVerifiedTotpCount(
  enabled: boolean,
): UsePractitionerVerifiedTotpCountResult {
  const [verifiedTotpCount, setVerifiedTotpCount] = useState(0);
  /** True while a factor fetch is required or in flight (when `enabled`). */
  const [pending, setPending] = useState(() => enabled);
  const [error, setError] = useState<Error | null>(null);
  const prevEnabledRef = useRef(enabled);
  /**
   * When true, the next pending-triggered fetch effect skips once so `refresh()` can own the load.
   * Cleared in `refresh` finally, when `enabled` becomes false, or when the effect consumes it.
   */
  const skipNextEffectFetchRef = useRef(false);
  const isMountedRef = useRef(true);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

  useLayoutEffect(() => {
    if (!enabled) {
      skipNextEffectFetchRef.current = false;
      setPending(false);
      setVerifiedTotpCount(0);
      setError(null);
      prevEnabledRef.current = false;
      return;
    }

    if (!prevEnabledRef.current) {
      setPending(true);
      setVerifiedTotpCount(0);
      setError(null);
    }
    prevEnabledRef.current = true;
  }, [enabled]);

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

  const refresh = useCallback(async (): Promise<void> => {
    if (!enabled) {
      return;
    }
    setError(null);
    skipNextEffectFetchRef.current = true;
    setPending(true);
    try {
      const n = await loadFactors();
      if (isMountedRef.current) {
        setVerifiedTotpCount(n);
        setError(null);
        setPending(false);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError(e instanceof Error ? e : new Error(String(e)));
        setPending(false);
      }
    } finally {
      skipNextEffectFetchRef.current = false;
    }
  }, [enabled, loadFactors]);

  useEffect(() => {
    if (!enabled || !pending) {
      return;
    }

    if (skipNextEffectFetchRef.current) {
      skipNextEffectFetchRef.current = false;
      return;
    }

    let cancelled = false;

    void (async () => {
      try {
        const n = await loadFactors();
        if (!cancelled && isMountedRef.current) {
          setVerifiedTotpCount(n);
          setError(null);
          setPending(false);
        }
      } catch (e) {
        if (!cancelled && isMountedRef.current) {
          setError(e instanceof Error ? e : new Error(String(e)));
          setPending(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, pending, loadFactors]);

  const loading = enabled && pending;

  return { verifiedTotpCount, loading, error, refresh };
}
