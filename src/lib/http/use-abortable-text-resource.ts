"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { readTextPrefix } from "./read-text-prefix";

type TextResourceState = {
  content: string | null;
  /** True when only the first `maxBytes` were read. */
  truncated: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

type Options = {
  href: string;
  fetcher?: typeof fetch;
  errorMessage?: (status: number) => string;
  getErrorMessage?: (error: unknown) => string;
  /** Read at most this many bytes (the rest of the download is cancelled). */
  maxBytes?: number;
};

const defaultStatusError = (status: number) => `Request failed (${status})`;
const defaultResourceError = (error: unknown) => error instanceof Error ? error.message : "Request failed";

/** Fetch a text resource while cancelling obsolete URL loads and unmount work. */
export function useAbortableTextResource({
  href,
  fetcher = fetch,
  errorMessage = defaultStatusError,
  getErrorMessage = defaultResourceError,
  maxBytes,
}: Options): TextResourceState {
  const [content, setContent] = useState<string | null>(null);
  const [truncated, setTruncated] = useState(false);
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
      const next = maxBytes === undefined
        ? { text: await response.text(), truncated: false }
        : await readTextPrefix(response, maxBytes);
      if (requestId !== requestRef.current) return;
      setContent(next.text);
      setTruncated(next.truncated);
    } catch (cause) {
      if (cause instanceof Error && cause.name === "AbortError") return;
      if (requestId !== requestRef.current) return;
      setContent(null);
      setError(getErrorMessageRef.current(cause));
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [href, maxBytes]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void reload(); }, 0);
    return () => {
      window.clearTimeout(timer);
      abortRef.current?.abort();
    };
  }, [reload]);

  return { content, truncated, loading, error, reload };
}
