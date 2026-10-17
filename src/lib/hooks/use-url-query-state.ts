"use client";

/**
 * Sync a small set of filter/sort keys into the URL query string so that
 * browser back/forward and shared links restore list state (FE-6).
 *
 * Replaces the URL to avoid stacking a history entry on every keystroke;
 * does not re-render Next.js server components.
 *
 * The first state comes from the request's search params (Next's
 * useSearchParams), which the server render and the browser's first render
 * see alike. Reading the address bar instead gave the server the defaults and
 * the browser the real filters: React then kept the server's attributes for
 * the mismatch, and a page opened from a filtered link showed the default
 * option, tab or page as selected.
 */

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { replaceBrowserUrl } from "@/lib/browser-history";

export type UrlQueryDefaults = Record<string, string>;

function readFromParams(keys: string[], defaults: UrlQueryDefaults, params: Pick<URLSearchParams, "get">): Record<string, string> {
  const next: Record<string, string> = { ...defaults };
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== "") {
      next[key] = value;
    }
  }
  return next;
}

function readFromLocation(keys: string[], defaults: UrlQueryDefaults): Record<string, string> {
  if (typeof window === "undefined") {
    return { ...defaults };
  }
  return readFromParams(keys, defaults, new URLSearchParams(window.location.search));
}

function writeToLocation(state: Record<string, string>, defaults: UrlQueryDefaults) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  for (const [key, value] of Object.entries(state)) {
    const def = defaults[key] ?? "";
    if (!value || value === def) {
      url.searchParams.delete(key);
    } else {
      url.searchParams.set(key, value);
    }
  }
  const next = `${url.pathname}${url.search}${url.hash}`;
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (next !== current) {
    replaceBrowserUrl(next);
  }
}

/**
 * @param defaults keys that participate in the URL; empty/default values are omitted
 * @param initial the query a page already normalised on the server (e.g. a page
 *   number clamped to the last page); otherwise the request's search params.
 */
export function useUrlQueryState<T extends UrlQueryDefaults>(defaults: T, initial?: Partial<Record<keyof T, string>>) {
  const defaultsRef = useRef(defaults);
  // Stable key list from first mount (callers pass a fixed key set).
  const [keys] = useState<string[]>(() => Object.keys(defaults));

  // Null outside the App Router (tests, the pages router): then the address bar.
  const searchParams = useSearchParams();
  const [state, setState] = useState<T>(() => {
    if (initial) {
      const next: Record<string, string> = { ...defaults };
      for (const key of keys) {
        const value = initial[key as keyof T];
        if (typeof value === "string" && value !== "") next[key] = value;
      }
      return next as T;
    }
    if (searchParams) return readFromParams(keys, defaults, searchParams) as T;
    return readFromLocation(keys, defaults) as T;
  });

  useEffect(() => {
    defaultsRef.current = defaults;
  }, [defaults]);

  useEffect(() => {
    const onPop = () => {
      setState(readFromLocation(keys, defaultsRef.current) as T);
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [keys]);

  useEffect(() => {
    writeToLocation(state, defaultsRef.current);
  }, [state]);

  const setField = useCallback(<K extends keyof T & string>(key: K, value: T[K]) => {
    setState((prev) => {
      if (prev[key] === value) return prev;
      return { ...prev, [key]: value };
    });
  }, []);

  const patch = useCallback((partial: Partial<T>) => {
    setState((prev) => ({ ...prev, ...partial }));
  }, []);

  return { state, setField, patch, setState };
}
