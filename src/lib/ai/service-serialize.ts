/**
 * AI service — DTO serializers.
 *
 * Extracted from `lib/ai/service.ts` as part of R28 god-file split.
 * Lives next to `service-crud` (owns the read queries) and
 * `service-runtime` (owns the chat-completion / model-fetch paths).
 */
import type { createProvider, getConversationById, listConversations } from "./service-crud";

/* ── Serialization ──────────────────────────────────────────── */

export function serializeProvider(p: Awaited<ReturnType<typeof createProvider>>) {
	return {
		...p,
		apiKey: p.apiKey.slice(0, 8) + "..." + p.apiKey.slice(-4),
		createdAt: p.createdAt.toISOString(),
		updatedAt: p.updatedAt.toISOString(),
	};
}

export function serializeConversation(c: Awaited<ReturnType<typeof getConversationById>>) {
	return {
		...c,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
		provider: c.provider
			? {
					...c.provider,
					createdAt: c.provider.createdAt.toISOString(),
					updatedAt: c.provider.updatedAt.toISOString(),
				}
			: null,
		messages: c.messages.map((m) => ({
			...m,
			createdAt: m.createdAt.toISOString(),
			hostedActions: m.hostedActions.map((action) => ({
				...action,
				createdAt: action.createdAt.toISOString(),
				approvedAt: action.approvedAt?.toISOString() ?? null,
				executedAt: action.executedAt?.toISOString() ?? null,
				completedAt: action.completedAt?.toISOString() ?? null,
			})),
		})),
	};
}

export function serializeConversationListItem(
	c: Awaited<ReturnType<typeof listConversations>>[number]
) {
	return {
		...c,
		createdAt: c.createdAt.toISOString(),
		updatedAt: c.updatedAt.toISOString(),
		provider: c.provider
			? {
					...c.provider,
				}
			: null,
	};
}
