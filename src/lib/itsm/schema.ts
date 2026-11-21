/**
 * Zod schemas for ITSM/IM connections + inbound/outbound events.
 */
import { z } from "zod";

import { ITSM_DIRECTION_VALUES, ITSM_PROVIDER_VALUES, type ItsmCredentials } from "./types";

export const itsmProviderSchema = z.enum(ITSM_PROVIDER_VALUES);
export const itsmDirectionSchema = z.enum(ITSM_DIRECTION_VALUES);

export const itsmCredentialsSchema = z
	.object({
		webhookSecret: z.string().trim().min(1).max(512).optional(),
		botToken: z.string().trim().min(1).max(512).optional(),
		signingSecret: z.string().trim().min(1).max(512).optional(),
		accessToken: z.string().trim().min(1).max(512).optional(),
	})
	.strict();

/**
 * The config object itself, with no `.default()`.
 *
 * `.default({})` inside `.optional()` still materialises the key: a body that
 * never mentioned `config` parses to `{ config: {} }`. On update that is
 * indistinguishable from "replace the config with an empty object", so a
 * `PATCH { enabled: false }` used to clear webhookUrl/chatId/headers — and, for
 * an outbound connection, get rejected by the outbound-readiness check instead.
 * Create keeps the default (an absent config there really does mean `{}`);
 * update uses this bare version so an absent key stays absent.
 */
const itsmConfigObjectSchema = z
	.object({
		webhookUrl: z.string().trim().max(2048).optional(),
		idempotentDelivery: z.boolean().optional(),
		chatId: z.string().trim().max(256).optional(),
		defaultPriority: z
			.enum(["LOW", "NORMAL", "HIGH", "URGENT", "low", "normal", "high", "urgent"])
			.optional(),
		defaultCategory: z.string().trim().max(64).optional(),
		createOnInbound: z.boolean().optional(),
		headers: z.record(z.string(), z.string().max(512)).optional(),
		workspace: z.string().trim().max(128).optional(),
	})
	.strict();

export const itsmConfigSchema = itsmConfigObjectSchema.default({});

const connectionFields = z
	.object({
		name: z.string().trim().min(1).max(128),
		provider: itsmProviderSchema,
		direction: itsmDirectionSchema.optional(),
		enabled: z.boolean().optional(),
		credentials: itsmCredentialsSchema.optional(),
		config: itsmConfigSchema.optional(),
		teamId: z.string().trim().min(1).max(64).optional().nullable(),
	});

type ConnectionFields = z.infer<typeof connectionFields>;

export function inboundSigningSecret(provider: string, credentials?: ItsmCredentials) {
	return provider === "slack" || provider === "feishu"
		? credentials?.signingSecret || credentials?.webhookSecret
		: credentials?.webhookSecret || credentials?.signingSecret;
}

function checkReadiness(val: Pick<ConnectionFields, "config" | "credentials" | "direction" | "provider" | "enabled">, ctx: z.RefinementCtx) {
	if (val.enabled === false) return;
	const direction = val.direction ?? "bidirectional";
	const needsOutbound = direction === "outbound" || direction === "bidirectional";
	const needsInbound = direction === "inbound" || direction === "bidirectional";
	const url = val.config?.webhookUrl?.trim();
	if (needsOutbound && val.provider !== "telegram" && !url) {
		ctx.addIssue({
			code: "custom",
			message: "Webhook URL is required when Webhook is enabled",
			path: ["config", "webhookUrl"],
		});
	}
	if (val.provider === "telegram" && needsOutbound && !val.credentials?.botToken) {
		ctx.addIssue({
			code: "custom",
			message: "API Key is required",
			path: ["credentials", "botToken"],
		});
	}
	if (val.provider === "telegram" && needsOutbound && !val.config?.chatId?.trim()) {
		ctx.addIssue({
			code: "custom",
			message: "Recipient is required",
			path: ["config", "chatId"],
		});
	}
	if (needsInbound && !inboundSigningSecret(val.provider, val.credentials)) {
		ctx.addIssue({
			code: "custom",
			path: ["credentials", val.provider === "slack" ? "signingSecret" : "webhookSecret"],
			message: "API Key is required",
		});
	}
}

export const createItsmConnectionSchema = connectionFields.superRefine(checkReadiness);

export const updateItsmConnectionSchema = z
	.object({
		name: z.string().trim().min(1).max(128).optional(),
		direction: itsmDirectionSchema.optional(),
		enabled: z.boolean().optional(),
		credentials: itsmCredentialsSchema.optional(),
		// Bare (undefaulted) so omitting `config` leaves the stored one alone.
		config: itsmConfigObjectSchema.optional(),
		teamId: z.string().trim().min(1).max(64).optional().nullable(),
	})
	.strict()
	.refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided" });

