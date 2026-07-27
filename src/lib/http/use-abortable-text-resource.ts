"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type TextResourceState = {
  content: string | null;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type Options = {
  href: string;
  fetcher?: typeof fetch;
  errorMessage?: (status: number) => string;
  getErrorMessage?: (error: unknown) => string;
};

const defaultStatusError = (status: number) => `Request failed (${status})`;
const defaultResourceError = (error: unknown) => error instanceof Error ? error.message : "Request failed";

/** Fetch a text resource while cancelling obsolete URL loads and unmount work. */
export function useAbortableTextResource({
  href,
  fetcher = fetch,
  errorMessage = defaultStatusError,
  getErrorMessage = defaultResourceError,
}: Options): TextResourceState {
  const [content, setContent] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const response = await fetcher(href, { signal: controller.signal });
      if (!response.ok) throw new Error(errorMessage(response.status));
      const next = await response.text();
      if (requestId !== requestRef.current) return;
      setContent(next);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      if (requestId !== requestRef.current) return;
      setContent(null);
      setError(getErrorMessage(cause));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [errorMessage, fetcher, getErrorMessage, href]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [reload]);

  return { content, loading, error, reload };
}
