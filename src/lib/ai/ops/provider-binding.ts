import { createHash, createHmac } from "node:crypto";
import type { AiProvider } from "@prisma/client";

import { getSessionSigningSecret } from "@/lib/auth/session";
import { safeDecryptApiKey } from "../service-crud";
import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { apiCopy } from "@/lib/i18n/api-copy";
import type { AiOpsMode } from "./types";

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

export async function readAiOpsSettings() {
	const rows = await prisma.setting.findMany({
		where: { key: { in: ["ai.ops.mode", "ai.ops.provider", AI_OPS_BINDING_KEY] } },
		select: { key: true, value: true },
	});
	const values = new Map(rows.map(({ key, value }) => [key, value]));
	const mode: AiOpsMode = values.get("ai.ops.mode") === "autonomous" ? "autonomous" : "recommendation";
	return { mode, providerId: values.get("ai.ops.provider")?.trim() ?? "", binding: values.get(AI_OPS_BINDING_KEY) ?? "" };
}

export function providerConfigurationVersion(provider: Endpoint & Pick<AiProvider, "apiKey">) {
	// Re-encryption and model discovery preserve the configuration identity. Keep short legacy credentials
	// out of guessable public digests. A damaged key still receives a distinct version and normal backoff.
	let credential = provider.apiKey;
	try { credential = safeDecryptApiKey(credential); } catch { /* The request reports the unreadable key. */ }
	return createHmac("sha256", getSessionSigningSecret())
		.update(JSON.stringify(["ai-ops-provider", provider.type, provider.baseUrl, provider.defaultModel, credential])).digest("hex");
}

/** Return the exact credential and endpoint snapshot approved to receive fleet data. */
export async function loadBoundAiOpsProvider(providerId: string) {
	const [current, provider] = await Promise.all([
		readAiOpsSettings(),
		prisma.aiProvider.findFirst({
			where: { id: providerId, enabled: true, creator: activePlatformAdmin },
			select: { ...endpointFields, apiKey: true, updatedAt: true },
		}),
	]);
	return current.providerId === providerId && provider && current.binding === serializeAiOpsProviderBinding(provider) ? provider : null;
}
