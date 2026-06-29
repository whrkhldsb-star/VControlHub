"use client";

/**
 * `useAiConfirmAction` — confirm-modal state + executor for the three
 * destructive flows on the AI page:
 *   - delete conversation
 *   - delete provider
 *   - clear messages
 *
 * Extracted from ai-client.tsx in R31. The parent passes side-effect
 * callbacks (e.g. clear-active, refresh-list); this hook owns busy/
 * error/queued action and exposes the copy used by AiConfirmDialog.
 */
import { type ReactNode, useCallback, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { useI18n } from "@/lib/i18n/use-locale";

export type AiConfirmAction =
  | { type: "delete-conversation"; id: string; title: string }
  | { type: "delete-provider"; id: string; name: string }
  | { type: "clear-messages" };

type Args = {
  activeConvId: string | null;
  activeConvProviderId: string | null | undefined;
  clearActiveConv: () => void;
  refreshConversations: () => Promise<void> | void;
  refreshProviders: () => Promise<void> | void;
  clearMessages: () => void;
};

export function useAiConfirmAction({
  activeConvId,
  activeConvProviderId,
  clearActiveConv,
  refreshConversations,
  refreshProviders,
  clearMessages,
}: Args) {
  const { t } = useI18n();
  const [action, setAction] = useState<AiConfirmAction | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((next: AiConfirmAction) => {
    setError(null);
    setAction(next);
  }, []);
  const close = useCallback(() => {
    if (busy) return;
    setAction(null);
    setError(null);
  }, [busy]);

  const copy: {
    title: string;
    confirmLabel: string;
    description: ReactNode;
  } | null = (() => {
    if (!action) return null;
    if (action.type === "delete-conversation") {
      return {
        title: t("aiPage.deleteConvTitle"),
        confirmLabel: t("aiPage.confirmDelete"),
        description: t("aiPage.deleteConvBody").replace(
          "{title}",
          action.title,
        ),
      };
    }
    if (action.type === "delete-provider") {
      return {
        title: t("aiPage.deleteProviderTitle"),
        confirmLabel: t("aiPage.confirmDelete"),
        description: t("aiPage.deleteProviderBody").replace(
          "{name}",
          action.name,
        ),
      };
    }
    return {
      title: t("aiPage.clearMessagesTitle2"),
      confirmLabel: t("aiPage.confirmClear"),
      description: t("aiPage.clearMessagesBody"),
    };
  })();

  const run = useCallback(async () => {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      if (action.type === "delete-conversation") {
        await csrfFetch(`/api/ai/conversations/${action.id}`, {
          method: "DELETE",
        });
        if (activeConvId === action.id) clearActiveConv();
        await refreshConversations();
      } else if (action.type === "delete-provider") {
        await csrfFetch(`/api/ai/providers/${action.id}`, { method: "DELETE" });
        if (activeConvProviderId === action.id) clearActiveConv();
        await refreshProviders();
        await refreshConversations();
      } else if (activeConvId) {
        await csrfFetch(`/api/ai/conversations/${activeConvId}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ clearMessages: true }),
        });
        clearMessages();
      }
      setAction(null);
    } catch (e: unknown) {
      const fallback =
        action.type === "clear-messages"
          ? t("aiPage.clearFailedFallback")
          : t("aiPage.deleteFailedFallback");
      setError(e instanceof Error ? e.message : fallback);
    } finally {
      setBusy(false);
    }
  }, [
    action,
    activeConvId,
    activeConvProviderId,
    clearActiveConv,
    refreshConversations,
    refreshProviders,
    clearMessages,
    t,
  ]);

  return { action, copy, busy, error, open, close, run };
}
