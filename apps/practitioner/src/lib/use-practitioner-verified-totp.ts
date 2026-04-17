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

/**
 * Loads verified TOTP factor count for practitioner MFA gating. No-ops when `enabled` is false.
 *
 * @param enabled - When false, clears counts and skips network calls (e.g. non-practitioner gates).
 * @returns Verified factor count, loading and error state, and a manual refresh.
 */
export function usePractitionerVerifiedTotpCount(
  enabled: boolean,
): UsePractitionerVerifiedTotpCountResult {
  const [verifiedTotpCount, setVerifiedTotpCount] = useState(0);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<Error | null>(null);
  const isMountedRef = useRef(true);
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);

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

  const refresh = useCallback(async () => {
    if (!enabled) {
      return;
    }
    setError(null);
    if (isMountedRef.current) {
      setLoading(true);
    }
    try {
      const n = await loadFactors();
      if (isMountedRef.current) {
        setVerifiedTotpCount(n);
      }
    } catch (e) {
      if (isMountedRef.current) {
        setError(e instanceof Error ? e : new Error(String(e)));
      }
    } finally {
      if (isMountedRef.current) {
        setLoading(false);
      }
    }
  }, [enabled, loadFactors]);

  useEffect(() => {
    if (!enabled) {
      setVerifiedTotpCount(0);
      setLoading(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    void (async () => {
      try {
        const n = await loadFactors();
        if (!cancelled) {
          setVerifiedTotpCount(n);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e : new Error(String(e)));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled, loadFactors]);

  return { verifiedTotpCount, loading, error, refresh };
}
