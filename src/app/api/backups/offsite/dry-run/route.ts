/**
 * TR-007 M03: 异地备份 (S3-compatible) dry-run API。
 *
 * POST — 立即触发一次 dry-run: load config → 校验 → write probe → HEAD → delete,
 *        返 4 种结果:
 *          200 + { ok: true, probeKey, latencyMs, ... }  成功
 *          422 + { ok: false, reason: "offsite_disabled" | "config_invalid", issues? }  配置问题
 *          502 + { error: "s3_error", code, message, status } 远端 / 凭据 / 网络失败
 */
import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { runOffsiteDryRun } from "@/lib/storage/offsite/dry-run";
import { S3Error } from "@/lib/storage/offsite/s3-client";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
	return withApiRoute(
		request,
		{
			permission: "backup:create",
			rateLimit: GENERAL_WRITE_LIMIT,
			errorStatus: 500,
			errorMessage: "dry-run failed",
		},
		async () => {
			try {
				const result = await runOffsiteDryRun();
				if (result.ok === false) {
					return NextResponse.json(result, { status: 422 });
				}
				return NextResponse.json(result);
			} catch (err) {
				if (err instanceof S3Error) {
					return NextResponse.json(
						{
							error: "s3_error",
							code: err.code,
							message: err.message,
							status: err.status,
						},
						{ status: 502 },
					);
				}
				throw err;
			}
		},
	);
}
