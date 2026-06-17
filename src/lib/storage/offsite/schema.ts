/**
 * TR-007 M03: 异地备份 offsite 配置 zod schema + 加载 / 校验。
 *
 * 凭据走 `settings` (加密 at-rest by `lib/crypto/service`),
 * 不在本模块另存明文。返回的 `OffsiteConfig` 仅在内存中存在, 不持久化。
 *
 * 双 schema 设计:
 *   - `OffsiteConfigSchema`: 接受"未填"状态 (空字符串), 用于持久化层
 *   - `validateOffsiteConfigForUse`: 用于 dry-run / 上传前校验必填项
 */
import { z } from "zod";

import { prisma } from "@/lib/db";
import { getAllSettings, getSetting } from "@/lib/settings/service";

/* ── Schemas ─────────────────────────────────────────────── */

export const OFFSITE_PROVIDER_VALUES = ["s3", "r2", "b2", "minio"] as const;
export type OffsiteProvider = (typeof OFFSITE_PROVIDER_VALUES)[number];

const providerSchema = z.enum(OFFSITE_PROVIDER_VALUES);

/** Persisted shape — accepts empty strings for not-yet-configured fields. */
export const OffsiteConfigSchema = z.object({
	enabled: z.boolean(),
	provider: providerSchema,
	endpoint: z.string(),
	region: z.string(),
	bucket: z.string(),
	accessKeyId: z.string(),
	secretAccessKey: z.string(),
	pathPrefix: z.string().transform((s) => s.trim()).transform((s) => s.replace(/\/?$/, "/")),
	dailyWindowHour: z.number().int().min(0).max(23),
	retentionDays: z.number().int().min(1).max(3650),
	failureAlertRecipient: z.string(),
});
export type OffsiteConfig = z.infer<typeof OffsiteConfigSchema>;

/** Returns a list of human-readable issues, empty list = ok. */
export function validateOffsiteConfigForUse(config: OffsiteConfig): string[] {
	const issues: string[] = [];
	if (!config.enabled) return issues; // not an issue, caller can short-circuit
	if (!config.endpoint.trim()) issues.push("endpoint 未配置");
	if (!config.region.trim()) issues.push("region 未配置");
	if (!config.bucket.trim()) issues.push("bucket 未配置");
	if (!config.accessKeyId.trim()) issues.push("accessKeyId 未配置");
	if (!config.secretAccessKey.trim()) issues.push("secretAccessKey 未配置");
	if (config.dailyWindowHour < 0 || config.dailyWindowHour > 23) {
		issues.push("dailyWindowHour 必须在 0 到 23 之间");
	}
	if (config.retentionDays < 1) {
		issues.push("retentionDays 必须 >= 1");
	}
	if (
		config.failureAlertRecipient.trim() &&
		!/^.+@.+\..+$/.test(config.failureAlertRecipient.trim())
	) {
		issues.push("failureAlertRecipient 不是合法邮箱");
	}
	return issues;
}

/* ── String ↔ typed coercion helpers ─────────────────────── */

function toBool(v: string): boolean {
	return v === "true" || v === "1";
}

function toInt(v: string, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) && Number.isInteger(n) ? n : fallback;
}

/* ── Load / Save ─────────────────────────────────────────── */

export async function loadOffsiteConfig(): Promise<OffsiteConfig> {
	const settings = await getAllSettings();
	return parseConfigFromMap(settings);
}

export function parseConfigFromMap(settings: Record<string, string>): OffsiteConfig {
	const draft = {
		enabled: toBool(settings["offsite.enabled"] ?? "false"),
		provider: ((settings["offsite.provider"] ?? "s3") as OffsiteProvider),
		endpoint: (settings["offsite.endpoint"] ?? "").trim(),
		region: (settings["offsite.region"] ?? "auto").trim(),
		bucket: (settings["offsite.bucket"] ?? "").trim(),
		accessKeyId: (settings["offsite.accessKeyId"] ?? "").trim(),
		secretAccessKey: settings["offsite.secretAccessKey"] ?? "",
		pathPrefix: (settings["offsite.pathPrefix"] ?? "vcontrolhub-backups/").trim(),
		dailyWindowHour: toInt(settings["offsite.dailyWindowHour"] ?? "3", 3),
		retentionDays: toInt(settings["offsite.retentionDays"] ?? "30", 30),
		failureAlertRecipient: (settings["offsite.failureAlertRecipient"] ?? "").trim(),
	};
	return OffsiteConfigSchema.parse(draft);
}

export const OFFSITE_SETTING_KEYS = [
	"offsite.enabled",
	"offsite.provider",
	"offsite.endpoint",
	"offsite.region",
	"offsite.bucket",
	"offsite.accessKeyId",
	"offsite.secretAccessKey",
	"offsite.pathPrefix",
	"offsite.dailyWindowHour",
	"offsite.retentionDays",
	"offsite.failureAlertRecipient",
] as const;

export type OffsiteConfigUpdate = Partial<OffsiteConfig>;

export async function saveOffsiteConfig(update: OffsiteConfigUpdate): Promise<OffsiteConfig> {
	const current = await loadOffsiteConfig();
	const merged = { ...current, ...update };
	const validated = OffsiteConfigSchema.parse(merged);
	await prisma.$transaction(
		(Object.entries(validated) as [string, unknown][]).map(([k, v]) => {
			const settingKey = `offsite.${camelToKebab(k)}`;
			const stringValue =
				k === "enabled"
					? (v ? "true" : "false")
					: String(v);
			return prisma.setting.upsert({
				where: { key: settingKey },
				update: { value: stringValue },
				create: { key: settingKey, value: stringValue },
			});
		}),
	);
	return validated;
}

function camelToKebab(s: string): string {
	return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

/* ── Single-key read for runtime paths ───────────────────── */

export async function isOffsiteEnabled(): Promise<boolean> {
	const v = await getSetting("offsite.enabled");
	return v === "true" || v === "1";
}
