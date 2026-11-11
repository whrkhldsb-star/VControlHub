/**
 * Zod schemas for ITSM/IM connections + inbound/outbound events.
 */
import { z } from "zod";

import { t } from "@/lib/i18n/service-translations";

import { ITSM_DIRECTION_VALUES, ITSM_PROVIDER_VALUES } from "./types";

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

export const createItsmConnectionSchema = z
	.object({
		name: z.string().trim().min(1).max(128),
		provider: itsmProviderSchema,
		direction: itsmDirectionSchema.optional(),
		enabled: z.boolean().optional(),
		credentials: itsmCredentialsSchema.optional(),
		config: itsmConfigSchema.optional(),
		teamId: z.string().trim().min(1).max(64).optional().nullable(),
	})
	// Said in the request's language (the translator reads it when the schema runs): these sentences are what the
	// form's toast shows for a field left empty.
	.superRefine((val, ctx) => {
		const direction = val.direction ?? "bidirectional";
		const needsOutbound = direction === "outbound" || direction === "bidirectional";
		const needsInbound = direction === "inbound" || direction === "bidirectional";
		const url = val.config?.webhookUrl?.trim();
		if (needsOutbound && val.provider !== "telegram" && !url) {
			ctx.addIssue({
				code: "custom",
				message: t("backend.itsm.webhookurlIsRequired"),
				path: ["config", "webhookUrl"],
			});
		}
		if (val.provider === "telegram" && needsOutbound && !val.credentials?.botToken) {
			ctx.addIssue({
				code: "custom",
				message: t("backend.itsm.telegramBottokenIsRequired"),
				path: ["credentials", "botToken"],
			});
		}
		if (val.provider === "telegram" && needsOutbound && !val.config?.chatId?.trim()) {
			ctx.addIssue({
				code: "custom",
				message: t("backend.itsm.telegramChatidIsRequired"),
				path: ["config", "chatId"],
			});
		}
		if (needsInbound && !val.credentials?.webhookSecret && val.provider !== "telegram") {
			// Allow missing secret but warn via validation only when inbound is primary without any secret
			// Soft: require secret for pure inbound to avoid open endpoints.
			if (direction === "inbound") {
				ctx.addIssue({
					code: "custom",
					message: t("backend.itsm.inboundSecretIsRequired"),
					path: ["credentials", "webhookSecret"],
				});
			}
		}
	});

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

