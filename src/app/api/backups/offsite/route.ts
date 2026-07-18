/**
 * TR-007 M03: 异地备份 (S3-compatible) 配置 API。
 *
 * GET  — 返回当前 offsite 配置 (secretAccessKey 脱敏为 ***)
 * POST — 局部更新 offsite 配置 (Partial<OffsiteConfig>), 走 settings 加密写入
 *
 * 权限: backup:read (GET), backup:create (POST, 与 retention / create 一致)
 */
import { NextResponse } from "next/server";
import { z } from "zod";

import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { loadOffsiteConfig, saveOffsiteConfig } from "@/lib/storage/offsite/service";
import { MASKED_VALUE } from "@/lib/settings/schema";

export const dynamic = "force-dynamic";

/**
 * GET 响应会脱敏 secretAccessKey, 其它字段原样返回 (endpoint / region / bucket
 * 等不算"凭据"但仍可视为内部配置, 鉴权后才暴露)。
 */
function maskConfig<T extends { secretAccessKey?: string }>(config: T): T {
	return { ...config, secretAccessKey: config.secretAccessKey ? MASKED_VALUE : "" };
}

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "backup:read" }, async () => {
		const config = await loadOffsiteConfig();
		return NextResponse.json({ config: maskConfig(config) });
	});
}

const OffsiteConfigUpdateApiSchema = z
	.object({
		enabled: z.boolean().optional(),
		provider: z.enum(["s3", "r2", "b2", "minio"]).optional(),
		endpoint: z.string().max(2048).optional(),
		region: z.string().max(128).optional(),
		bucket: z.string().max(128).optional(),
		accessKeyId: z.string().max(256).optional(),
		secretAccessKey: z.string().max(512).optional(),
		pathPrefix: z.string().max(256).optional(),
		dailyWindowHour: z.number().int().min(0).max(23).optional(),
		retentionDays: z.number().int().min(1).max(3650).optional(),
		failureAlertRecipient: z.string().max(256).optional(),
	})
	.strict();

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "backup:create",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "Failed to save offsite backup configuration",
			bodySchema: OffsiteConfigUpdateApiSchema,
		},
		async ({ session, body }) => {
			const next = await saveOffsiteConfig(body);
			await auditUserAction(session?.userId ?? "", "backup.offsite.update", {
				enabled: next.enabled,
				provider: next.provider,
				bucket: next.bucket,
				endpoint: next.endpoint,
				region: next.region,
				pathPrefix: next.pathPrefix,
				dailyWindowHour: next.dailyWindowHour,
				retentionDays: next.retentionDays,
				// never log secretAccessKey / accessKeyId values
				hasAccessKeyId: Boolean(next.accessKeyId),
				hasSecretAccessKey: Boolean(next.secretAccessKey),
			}, undefined, session?.currentTeamId);
			return NextResponse.json({ config: maskConfig(next) });
		},
	);
}
