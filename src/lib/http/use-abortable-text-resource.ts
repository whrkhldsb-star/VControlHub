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
  const fetcherRef = useRef(fetcher);
  const errorMessageRef = useRef(errorMessage);
  const getErrorMessageRef = useRef(getErrorMessage);

  useEffect(() => {
    fetcherRef.current = fetcher;
    errorMessageRef.current = errorMessage;
    getErrorMessageRef.current = getErrorMessage;
  }, [errorMessage, fetcher, getErrorMessage]);

  const reload = useCallback(async () => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const requestId = ++requestRef.current;
    setLoading(true);
    setError(null);
    try {
      const currentFetcher = fetcherRef.current;
      const response = await currentFetcher(href, { signal: controller.signal });
      if (!response.ok) throw new Error(errorMessageRef.current(response.status));
      const next = await response.text();
      if (requestId !== requestRef.current) return;
      setContent(next);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      if (requestId !== requestRef.current) return;
      setContent(null);
      setError(getErrorMessageRef.current(cause));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [href]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [reload]);

  return { content, loading, error, reload };
}
