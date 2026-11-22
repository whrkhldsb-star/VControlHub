import { apiCopy } from "@/lib/i18n/api-copy";
/**
 * TR-007 M03: 异地备份 (S3-compatible) 配置 API。
 *
 * GET  — 返回当前 offsite 配置 (secretAccessKey 脱敏为 ***)
 * POST — 局部更新 offsite 配置 (Partial<OffsiteConfig>), 走 settings 加密写入
 *
 * 权限: backup:read (GET), backup:create (POST, 与 retention / create 一致)
 */
import { NextResponse } from "next/server";

import { assertPlatformAdmin } from "@/lib/auth/platform-admin-guard";
import { auditUserAction } from "@/lib/audit/service";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { loadOffsiteConfig, saveOffsiteConfig } from "@/lib/storage/offsite/service";
import { publicOffsiteEndpoint } from "@/lib/settings/bindings";
import { MASKED_VALUE } from "@/lib/settings/schema";
import { offsiteConfigUpdateApiSchema } from "@/lib/storage/offsite/schema";

export const dynamic = "force-dynamic";

/**
 * GET/POST 响应脱敏 accessKeyId + secretAccessKey（与 settings isSensitiveKey 一致）。
 * 旧端点也经过清理，避免将 URL 中的凭据返回给客户端。
 */
function maskConfig<T extends { endpoint: string; accessKeyId?: string; secretAccessKey?: string }>(config: T): T {
	return {
		...config,
		endpoint: config.endpoint ? publicOffsiteEndpoint(config.endpoint) : "",
		accessKeyId: config.accessKeyId ? MASKED_VALUE : "",
		secretAccessKey: config.secretAccessKey ? MASKED_VALUE : "",
	};
}

export async function GET(request: Request) {
	return withApiRoute(request, { permission: "backup:read" }, async ({ session }) => {
		assertPlatformAdmin(session);
		const config = await loadOffsiteConfig();
		return NextResponse.json({ config: maskConfig(config) });
	});
}

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "backup:create",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: apiCopy("apiCopy.failed.to.save.offsite.backup.configuration.f958b795"),
			bodySchema: offsiteConfigUpdateApiSchema,
		},
		async ({ session, body }) => {
			assertPlatformAdmin(session);
			const next = await saveOffsiteConfig(body, session.userId);
			await auditUserAction(session.userId, "backup.offsite.update", {
				enabled: next.enabled,
				provider: next.provider,
				bucket: next.bucket,
				endpoint: publicOffsiteEndpoint(next.endpoint),
				region: next.region,
				pathPrefix: next.pathPrefix,
				dailyWindowHour: next.dailyWindowHour,
				retentionDays: next.retentionDays,
				// never log secretAccessKey / accessKeyId values
				hasAccessKeyId: Boolean(next.accessKeyId),
				hasSecretAccessKey: Boolean(next.secretAccessKey),
			}, undefined, null);
			return NextResponse.json({ config: maskConfig(next) });
		},
	);
}
