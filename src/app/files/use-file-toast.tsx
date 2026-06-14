"use client";

import { useCallback, useState } from "react";

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

  const showToast = useCallback(
    (type: FileToast["type"], message: string) => {
      const id = Date.now() + Math.floor(Math.random() * 1000);
      setToasts((current) => [...current.slice(-2), { id, type, message }]);
      window.setTimeout(() => {
        setToasts((current) => current.filter((toast) => toast.id !== id));
      }, 3800);
    },
    [],
  );

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  return { toasts, showToast, dismissToast } as const;
}
