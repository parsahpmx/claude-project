"use client";

/**
 * Data loading with an explicit three-state result.
 *
 * `loading`, `error` and `data` are separate rather than collapsed into "data or null",
 * because a console must be able to distinguish *no positions* from *could not ask*. The
 * two look identical in a nullable model and mean opposite things to an operator.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "@/lib/api";

export interface Query<T> {
  data: T | null;
  error: string | null;
  loading: boolean;
  /** Set once the first response has arrived, so a refresh does not blank the screen. */
  loaded: boolean;
  refresh: () => void;
}

export function useApi<T>(
  fetcher: () => Promise<T>,
  deps: readonly unknown[] = [],
  refreshMs = 0,
): Query<T> {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  // Kept in a ref so a fetcher redefined on every render does not restart the effect.
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetcherRef
      .current()
      .then((result) => {
        if (cancelled) return;
        setData(result);
        setError(null);
        setLoaded(true);
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        // The previous data is cleared deliberately: a stale figure under a stale error is
        // how a console shows a number that stopped being true minutes ago.
        setData(null);
        setError(cause instanceof ApiError ? cause.message : String(cause));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  useEffect(() => {
    if (refreshMs <= 0) return;
    const handle = window.setInterval(refresh, refreshMs);
    return () => window.clearInterval(handle);
  }, [refreshMs, refresh]);

  return { data, error, loading, loaded, refresh };
}
