/**
 * Zod schemas for ITSM/IM connections + inbound/outbound events.
 */
import { z } from "zod";

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

export const itsmConfigSchema = z
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
	.strict()
	.default({});

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
	.superRefine((val, ctx) => {
		const direction = val.direction ?? "bidirectional";
		const needsOutbound = direction === "outbound" || direction === "bidirectional";
		const needsInbound = direction === "inbound" || direction === "bidirectional";
		const url = val.config?.webhookUrl?.trim();
		if (needsOutbound && val.provider !== "telegram" && !url) {
			ctx.addIssue({
				code: "custom",
				message: "webhookUrl is required for outbound-capable connections",
				path: ["config", "webhookUrl"],
			});
		}
		if (val.provider === "telegram" && needsOutbound && !val.credentials?.botToken) {
			ctx.addIssue({
				code: "custom",
				message: "telegram outbound requires credentials.botToken",
				path: ["credentials", "botToken"],
			});
		}
		if (needsInbound && !val.credentials?.webhookSecret && val.provider !== "telegram") {
			// Allow missing secret but warn via validation only when inbound is primary without any secret
			// Soft: require secret for pure inbound to avoid open endpoints.
			if (direction === "inbound") {
				ctx.addIssue({
					code: "custom",
					message: "inbound connections should set credentials.webhookSecret",
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
		config: itsmConfigSchema.optional(),
		teamId: z.string().trim().min(1).max(64).optional().nullable(),
	})
	.strict()
	.refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided" });

export const itsmInboundBodySchema = z
	.object({
		eventType: z.string().trim().min(1).max(64).optional(),
		externalId: z.string().trim().max(256).optional(),
		ticket: z
			.object({
				title: z.string().trim().min(1).max(256).optional(),
				description: z.string().trim().max(10_000).optional(),
				status: z.string().trim().max(32).optional(),
				priority: z.string().trim().max(32).optional(),
				category: z.string().trim().max(64).optional(),
				id: z.string().trim().max(64).optional(),
			})
			.optional(),
		comment: z
			.object({
				body: z.string().trim().min(1).max(10_000),
			})
			.optional(),
		// Pass-through raw fields for provider adapters
		text: z.string().optional(),
		message: z.union([z.string(), z.record(z.string(), z.unknown())]).optional(),
	})
	.passthrough();

export const itsmTestSchema = z
	.object({
		message: z.string().trim().max(500).optional(),
	})
	.strict()
	.optional()
	.default({});

export type CreateItsmConnectionInput = z.infer<typeof createItsmConnectionSchema>;
export type UpdateItsmConnectionInput = z.infer<typeof updateItsmConnectionSchema>;
