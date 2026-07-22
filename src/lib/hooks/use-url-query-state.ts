"use client";

/**
 * Sync a small set of filter/sort keys into the URL query string so that
 * browser back/forward and shared links restore list state (FE-6).
 *
 * Uses history.replaceState to avoid stacking a history entry on every
 * keystroke; does not re-render Next.js server components.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type UrlQueryDefaults = Record<string, string>;

function readFromLocation(keys: string[], defaults: UrlQueryDefaults): Record<string, string> {
  if (typeof window === "undefined") {
    return { ...defaults };
  }
  const params = new URLSearchParams(window.location.search);
  const next: Record<string, string> = { ...defaults };
  for (const key of keys) {
    const value = params.get(key);
    if (value !== null && value !== "") {
      next[key] = value;
    }
  }
  return next;
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
    window.history.replaceState(window.history.state, "", next);
  }
}

/** @param defaults keys that participate in the URL; empty/default values are omitted */
export function useUrlQueryState<T extends UrlQueryDefaults>(defaults: T) {
  const defaultsRef = useRef(defaults);
  defaultsRef.current = defaults;
  // Stable key list from first mount (callers pass a fixed key set).
  const keysRef = useRef<string[]>(Object.keys(defaults));
  const keys = keysRef.current;

  const [state, setState] = useState<T>(() => readFromLocation(keys, defaults) as T);

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
