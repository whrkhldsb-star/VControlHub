"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export type FileToast = {
  id: number;
  type: "success" | "error" | "info";
  message: string;
};

export type FileToastInput = { type: FileToast["type"]; message: string };

/**
 * Toast manager for file-list (and similar) pages.
 *
 * Renders a small stack of toasts; old toasts are auto-dismissed after
 * 3.8s. Up to 3 toasts are kept in the visible window — older ones are
 * evicted FIFO. `dismissToast` removes a specific toast by id (used by
 * the close button on each toast).
 *
 * Extracted from file-list-client.tsx in R21.
 */
export function useFileToast() {
  const [toasts, setToasts] = useState<FileToast[]>([]);
  const timeoutIdsRef = useRef<Set<number>>(new Set());

  useEffect(() => {
    const timeoutIds = timeoutIdsRef.current;
    return () => {
      for (const timeoutId of timeoutIds) {
        window.clearTimeout(timeoutId);
      }
      timeoutIds.clear();
    };
  }, []);

  const showToast = useCallback(
    (type: FileToast["type"], message: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current.slice(-2), { id, type, message }]);
      const timeoutId = window.setTimeout(() => {
        timeoutIdsRef.current.delete(timeoutId);
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 3800);
      timeoutIdsRef.current.add(timeoutId);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, showToast, dismissToast } as const;
}
