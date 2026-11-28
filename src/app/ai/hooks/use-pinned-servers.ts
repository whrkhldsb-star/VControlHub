"use client";

/**
 * `usePinnedServers` — the servers pinned to the open conversation, changed from the chips bar above the
 * composer and saved at once with PATCH /api/ai/conversations/[id] `{ pinnedServerIds }`. The chips change as
 * soon as the user clicks; a refused save puts them back and says why.
 */
import { useCallback, useState } from "react";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { getErrorMessage } from "@/lib/http/error-message";
import { useI18n } from "@/lib/i18n/use-locale";
import type { ToastFn } from "@/components/toast-provider";

import type { ConvItem } from "../ai-types";

/** What PATCH /api/ai/conversations/[id] accepts (`pinnedServerIds` max 20). */
export const MAX_PINNED_SERVERS = 20;

export function usePinnedServers({
	activeConv,
	onConversationUpdated,
	addToast,
}: {
	activeConv: ConvItem | null;
	onConversationUpdated: (conversation: ConvItem) => void;
	addToast: ToastFn;
}) {
	const { t } = useI18n();
	const [pending, setPending] = useState<{ conversationId: string; ids: string[] } | null>(null);

	const saved = activeConv?.pinnedServerIds ?? [];
	const pinnedIds = pending && pending.conversationId === activeConv?.id ? pending.ids : saved;

	const setPinned = useCallback(async (ids: string[]) => {
		if (!activeConv) return;
		const unique = Array.from(new Set(ids)).slice(0, MAX_PINNED_SERVERS);
		const conversationId = activeConv.id;
		setPending({ conversationId, ids: unique });
		try {
			const data = await csrfFetch<{ conversation?: ConvItem }>(`/api/ai/conversations/${conversationId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ pinnedServerIds: unique }),
			});
			if (data?.conversation) onConversationUpdated(data.conversation);
		} catch (error) {
			addToast("error", getErrorMessage(error, t("aiPage.pins.saveFailed")));
		} finally {
			setPending((current) => (current?.conversationId === conversationId && current.ids === unique ? null : current));
		}
	}, [activeConv, addToast, onConversationUpdated, t]);

	return { pinnedIds, saving: pending !== null && pending.conversationId === activeConv?.id, setPinned };
}
