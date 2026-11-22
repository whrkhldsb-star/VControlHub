/**
 * Zod schemas for cloud billing accounts + sync.
 */
import { z } from "zod";

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
	(cfg, ctx): CloudBillingConfigParsed => {
		const raw = cfg.billingCsvUrl?.trim();
		// Report the SSRF/credential rejection as a zod issue rather than throwing
		// out of the transform: a throw escapes `safeParse` itself, so every caller
		// would have to wrap validation in try/catch to get a 400 instead of a 500.
		let billingCsvUrl: string | undefined;
		if (raw) {
			try {
				billingCsvUrl = normalizePublicHttpUrl(raw);
			} catch {
				ctx.addIssue({
					code: "invalid_format",
					format: "public HTTP(S) URL without credentials",
					path: ["billingCsvUrl"],
				});
			}
		}
		return {
			region: cfg.region,
			accountId: cfg.accountId,
			sampleCsv: cfg.sampleCsv,
			billingCsvUrl,
			categoryMap: cfg.categoryMap,
		};
	},
);

function validateCsvSource(val: { provider: string; config: CloudBillingConfigParsed }, ctx: z.RefinementCtx) {
	if (val.provider !== "generic_csv" || val.config.sampleCsv?.trim() || val.config.billingCsvUrl?.trim()) return;
	for (const field of ["sampleCsv", "billingCsvUrl"]) {
		ctx.addIssue({ code: "custom", path: ["config", field], message: "At least one field must be provided" });
	}
}

export const billingSourceSchema = z.object({ provider: cloudBillingProviderSchema, config: cloudBillingConfigSchema }).superRefine(validateCsvSource);

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
	.superRefine(validateCsvSource);

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
	confirmLegacyDuplicates: z.boolean().optional(),
});

