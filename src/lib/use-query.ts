"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiFetch } from "./api";

type CacheEntry = {
  data: unknown;
  error: Error | null;
  fetchedAt: number;
  promise: Promise<unknown> | null;
};

const cache = new Map<string, CacheEntry>();
const subscribers = new Map<string, Set<() => void>>();
const DEFAULT_TTL_MS = 30_000;

function notify(key: string) {
  subscribers.get(key)?.forEach((fn) => fn());
}

function subscribe(key: string, fn: () => void) {
  if (!subscribers.has(key)) subscribers.set(key, new Set());
  subscribers.get(key)!.add(fn);
  return () => {
    const set = subscribers.get(key);
    set?.delete(fn);
    if (set && set.size === 0) subscribers.delete(key);
  };
}


export function fetchKey<T = unknown>(
  key: string,
  { force = false, ttlMs = DEFAULT_TTL_MS }: { force?: boolean; ttlMs?: number } = {},
): Promise<T> {
  const entry = cache.get(key);

  if (entry?.promise) return entry.promise as Promise<T>;
  if (!force && entry && Date.now() - entry.fetchedAt < ttlMs && !entry.error) {
    return Promise.resolve(entry.data as T);
  }

  const promise = apiFetch<T>(key, { credentials: "include" })
    .then((data) => {
      cache.set(key, { data, error: null, fetchedAt: Date.now(), promise: null });
      notify(key);
      return data;
    })
    .catch((error: Error) => {
      cache.set(key, {
        data: entry?.data ?? undefined,
        error,
        fetchedAt: Date.now(),
        promise: null,
      });
      notify(key);
      throw error;
    });

  cache.set(key, {
    data: entry?.data,
    error: entry?.error ?? null,
    fetchedAt: entry?.fetchedAt ?? 0,
    promise,
  });
  return promise;
}
export function invalidate(...keys: string[]) {
  for (const key of keys) {
    cache.delete(key);
    notify(key);
  }
}

export type QueryResult<T> = {
  data: T | undefined;
  error: Error | null;
  loading: boolean;
  refresh: () => Promise<T | undefined>;
};

export function useQuery<T = unknown>(
  key: string | null,
  { ttlMs = DEFAULT_TTL_MS }: { ttlMs?: number } = {},
): QueryResult<T> {
  const [, forceRender] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!key) return;
    // Re-render whenever this key's cache entry changes, including when another
    // component or a mutation updates it.
    const unsubscribe = subscribe(key, () => {
      if (mounted.current) forceRender((n) => n + 1);
    });

    fetchKey<T>(key, { ttlMs }).catch(() => {
      /* stored on the cache entry and surfaced as `error` below */
    });

    return unsubscribe;
  }, [key, ttlMs]);

  const refresh = useCallback(async () => {
    if (!key) return undefined;
    try {
      return await fetchKey<T>(key, { force: true, ttlMs });
    } catch {
      return undefined;
    }
  }, [key, ttlMs]);

  const current = key ? cache.get(key) : undefined;
  return {
    data: current?.data as T | undefined,
    error: current?.error ?? null,
    loading: Boolean(key) && current?.data === undefined && !current?.error,
    refresh,
  };
}

// Keys for the endpoints read by more than one page. Using the constant rather
// than a string literal is what makes the cache shared instead of per-page.
export const QUERY_KEYS = {
  company: "/api/company",
  segments: "/api/sales/segments",
} as const;
