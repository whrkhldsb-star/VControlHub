/**
 * Zod schemas for cloud billing accounts + sync.
 */
import { z } from "zod";

import { ValidationError } from "@/lib/errors";
import { normalizePublicHttpUrl } from "@/lib/storage/direct-access-url";

import { costCurrencySchema, costMonthSchema } from "../schema";
import { CLOUD_BILLING_PROVIDER_VALUES } from "./types";

export const cloudBillingProviderSchema = z.enum(CLOUD_BILLING_PROVIDER_VALUES);

export const cloudBillingCredentialsSchema = z
	.object({
		accessKeyId: z.string().trim().min(1).max(256).optional(),
		secretAccessKey: z.string().trim().min(1).max(512).optional(),
		sessionToken: z.string().trim().max(4096).optional(),
		roleArn: z.string().trim().max(512).optional(),
	})
	.strict();

function normalizeBillingCsvUrl(value: string): string {
	try {
		return normalizePublicHttpUrl(
			value,
			"billingCsvUrl must be a public http(s) URL without credentials",
		);
	} catch (error) {
		if (error instanceof ValidationError) throw error;
		throw new ValidationError(
			error instanceof Error ? error.message : "billingCsvUrl is not a valid public URL",
		);
	}
}

const cloudBillingConfigObjectSchema = z
	.object({
		region: z.string().trim().max(64).optional(),
		accountId: z.string().trim().max(128).optional(),
		sampleCsv: z.string().max(200_000).optional(),
		/** HTTPS/HTTP CSV export URL (CUR dump, custom bill export). Validated against public-host SSRF rules. */
		billingCsvUrl: z.string().trim().max(2048).optional(),
		categoryMap: z.record(z.string(), z.enum(["vps", "bandwidth", "storage", "other"])).optional(),
	})
	.strict();

export type CloudBillingConfigParsed = {
	region?: string;
	accountId?: string;
	sampleCsv?: string;
	billingCsvUrl?: string;
	categoryMap?: Record<string, "vps" | "bandwidth" | "storage" | "other">;
};

export const cloudBillingConfigSchema = cloudBillingConfigObjectSchema.transform(
	(cfg): CloudBillingConfigParsed => {
		const raw = cfg.billingCsvUrl?.trim();
		return {
			region: cfg.region,
			accountId: cfg.accountId,
			sampleCsv: cfg.sampleCsv,
			billingCsvUrl: raw ? normalizeBillingCsvUrl(raw) : undefined,
			categoryMap: cfg.categoryMap,
		};
	},
);

export const createCloudBillingAccountSchema = z
	.object({
		name: z.string().trim().min(1).max(128),
		provider: cloudBillingProviderSchema,
		currency: costCurrencySchema.optional(),
		enabled: z.boolean().optional(),
		credentials: cloudBillingCredentialsSchema,
		config: cloudBillingConfigSchema.optional(),
		// teamId is session-derived only; strip any client-supplied value.
		teamId: z.unknown().optional(),
	})
	.strict()
	.transform(({ teamId: _teamId, ...rest }) => ({
		...rest,
		config: rest.config ?? ({} as CloudBillingConfigParsed),
	}))
	.superRefine((val, ctx) => {
		if (val.provider !== "generic_csv") {
			if (!val.credentials.accessKeyId || !val.credentials.secretAccessKey) {
				ctx.addIssue({
					code: "custom",
					message: "accessKeyId and secretAccessKey are required for this provider",
					path: ["credentials"],
				});
			}
			return;
		}
		const hasSample = Boolean(val.config?.sampleCsv?.trim());
		const hasUrl = Boolean(val.config?.billingCsvUrl?.trim());
		if (!hasSample && !hasUrl) {
			ctx.addIssue({
				code: "custom",
				message: "generic_csv requires config.sampleCsv or config.billingCsvUrl",
				path: ["config"],
			});
		}
	});

export const updateCloudBillingAccountSchema = z
	.object({
		name: z.string().trim().min(1).max(128).optional(),
		currency: costCurrencySchema.optional(),
		enabled: z.boolean().optional(),
		credentials: cloudBillingCredentialsSchema.optional(),
		config: cloudBillingConfigSchema.optional(),
		// teamId is session-derived only; strip any client-supplied value.
		teamId: z.unknown().optional(),
	})
	.strict()
	.transform(({ teamId: _teamId, ...rest }) => rest)
	.refine((v) => Object.keys(v).length > 0, { message: "At least one field must be provided" });

export const syncCloudBillingSchema = z.object({
	month: costMonthSchema.optional(),
});

export type CreateCloudBillingAccountInput = z.infer<typeof createCloudBillingAccountSchema>;
export type UpdateCloudBillingAccountInput = z.infer<typeof updateCloudBillingAccountSchema>;
