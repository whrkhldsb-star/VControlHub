import { createHash } from "node:crypto";
import type { AiProvider } from "@prisma/client";

import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import { getSetting } from "@/lib/settings/service";

export const AI_OPS_BINDING_KEY = "ai.ops.providerBinding";

const activePlatformAdmin = {
	status: "ACTIVE", mustChangePassword: false, roles: { some: { role: { key: "admin" } } },
} as const;
const endpointFields = { id: true, createdBy: true, type: true, baseUrl: true, defaultModel: true } as const;
type Endpoint = Pick<AiProvider, keyof typeof endpointFields>;

export function serializeAiOpsProviderBinding(provider: Endpoint): string {
	const fingerprint = createHash("sha256")
		.update(JSON.stringify([provider.type, provider.baseUrl, provider.defaultModel]))
		.digest("hex");
	return JSON.stringify({ providerId: provider.id, ownerId: provider.createdBy, fingerprint });
}

export async function prepareAiOpsProviderBinding(providerId: string, ownerId: string) {
	let binding = "";
	if (providerId) {
		const provider = await prisma.aiProvider.findFirst({
			where: { id: providerId, createdBy: ownerId, enabled: true, creator: activePlatformAdmin },
			select: endpointFields,
		});
		if (!provider) {
			throw new ValidationError(apiCopy("apiCopy.the.selected.ai.provider.was.not.found.is.disabled.or.belongs.to.62229a8e"));
		}
		binding = serializeAiOpsProviderBinding(provider);
	}
	return [{ key: "ai.ops.provider", value: providerId }, { key: AI_OPS_BINDING_KEY, value: binding }];
}

/** Return the exact credential and endpoint snapshot approved to receive fleet data. */
export async function loadBoundAiOpsProvider(providerId: string) {
	const [currentId, binding, provider] = await Promise.all([
		getSetting("ai.ops.provider"),
		getSetting(AI_OPS_BINDING_KEY),
		prisma.aiProvider.findFirst({
			where: { id: providerId, enabled: true, creator: activePlatformAdmin },
			select: { ...endpointFields, apiKey: true, updatedAt: true },
		}),
	]);
	return currentId === providerId && provider && binding === serializeAiOpsProviderBinding(provider) ? provider : null;
}
