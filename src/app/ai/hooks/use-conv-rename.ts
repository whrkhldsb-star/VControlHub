"use client";

/**
 * `useConvRename` — rename-modal state + PATCH handler for the AI page.
 *
 * Extracted from ai-client.tsx in R31. The dialog itself lives in
 * `AiRenameDialog`; this hook owns busy/error/open + submit logic.
 */
import { useCallback, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

type ToastFn = (kind: "success" | "error" | "info", message: string) => void;

export function useConvRename({
  activeConvId,
  refreshConversations,
  addToast,
}: {
  activeConvId: string | null;
  refreshConversations: () => Promise<void> | void;
  addToast: ToastFn;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const openWith = useCallback((initial: string) => {
    setTitle(initial);
    setError(null);
    setOpen(true);
  }, []);

  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);

  const submit = useCallback(async () => {
    if (!activeConvId) return;
    const next = title.trim();
    if (!next) {
      setError(t("aiPage.saveTitlePrompt"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
      await refreshConversations();
      setOpen(false);
      addToast("success", t("aiPage.titleUpdated"));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("aiPage.renameFailed"));
    } finally {
      setBusy(false);
    }
  }, [activeConvId, title, refreshConversations, addToast, t]);

  return { open, title, busy, error, setTitle, openWith, close, submit };
}
