import type { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { normalizeEndpoint } from "@/lib/storage/offsite/s3-client";
import { OFFSITE_SETTING_KEYS, parseConfigFromMap } from "@/lib/storage/offsite/schema";
import { isSensitiveKey } from "./schema";

const bindings = [
	{ endpoints: ["smtp.host", "smtp.user", "smtp.port", "smtp.requireTls"], secrets: ["smtp.pass"] },
	{ endpoints: ["offsite.endpoint", "offsite.provider", "offsite.bucket"], secrets: ["offsite.accessKeyId", "offsite.secretAccessKey"] },
];
const defaults: Record<string, string> = { "smtp.port": "587", "smtp.requireTls": "false", "offsite.provider": "s3", "offsite.region": "auto" };

// A table lock also covers absent keys. Taking it before a serializable
// import's first SELECT ensures the merged view includes the previous writer.
export function lockSettingBindings(tx: Pick<Prisma.TransactionClient, "$executeRaw">) {
	return tx.$executeRaw`LOCK TABLE settings IN SHARE ROW EXCLUSIVE MODE`;
}

export function relatedSettingKeys(keys: Iterable<string>): Set<string> {
	const result = new Set<string>();
	for (const key of keys) {
		if (key.startsWith("offsite.")) for (const field of OFFSITE_SETTING_KEYS) result.add(field);
		if (key === "telegram.enabled" || key === "telegram.chatId") {
			result.add("telegram.enabled");
			result.add("telegram.chatId");
		}
		for (const { endpoints, secrets } of bindings) {
			if (endpoints.includes(key) || secrets.includes(key)) {
				for (const field of [...endpoints, ...secrets]) result.add(field);
			}
		}
	}
	return result;
}

/** An invalid historical endpoint is never reflected to the settings forms. */
export function publicOffsiteEndpoint(value: string): string {
	try {
		const url = new URL(value);
		url.username = "";
		url.password = "";
		return normalizeEndpoint(url.toString());
	} catch {
		return "";
	}
}

function invalidBinding(field: string, reason: string) {
	return new ValidationError(t(reason, { key: field }), { field, reason });
}

export function validateSettingBindings(current: Map<string, string>, writes: Map<string, string>, readSecret: (value: string) => string) {
	const effective = (key: string) => writes.get(key) ?? current.get(key) ?? defaults[key] ?? "";
	if ([...writes.keys()].some((key) => key.startsWith("offsite."))) {
		let field = "offsite.endpoint";
		try {
			const config = parseConfigFromMap(Object.fromEntries(OFFSITE_SETTING_KEYS.filter((k) => !isSensitiveKey(k))
				.map((k) => [k, writes.get(k) ?? current.get(k)]).filter(([, v]) => v !== undefined)));
			if (config.endpoint) {
				normalizeEndpoint(config.endpoint);
				const url = new URL(config.endpoint);
				if (url.search || url.hash) throw new Error();
			}
			if (config.enabled && !config.pathPrefix) { field = "offsite.pathPrefix"; throw new Error(); }
		} catch (error) {
			if (error instanceof ZodError) field = "offsite." + String(error.issues[0]?.path[0] ?? "");
			throw invalidBinding(field, "backend.settings.invalidValue");
		}
	}
	for (const { endpoints, secrets } of bindings) {
		if (!endpoints.some((k) => writes.has(k) && effective(k) !== (current.get(k) ?? defaults[k] ?? ""))) continue;
		for (const key of secrets) {
			const stored = current.get(key);
			if (!stored || writes.get(key) === "") continue;
			const previous = readSecret(stored);
			if (previous && (!writes.has(key) || writes.get(key) === previous || writes.get(key) === stored)) {
				throw invalidBinding(key, "backend.settings.importCredentialRequired");
			}
		}
	}
	if ((writes.has("telegram.enabled") || writes.has("telegram.chatId")) &&
		effective("telegram.enabled") === "true" && !effective("telegram.chatId").trim()) {
		throw invalidBinding("telegram.chatId", "backend.settings.telegramChatIdRequired");
	}
}
