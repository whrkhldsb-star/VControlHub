/**
 * TR-007 M03: 异地备份 dry-run: 用当前配置连一下, 写一个 probe 对象, 立刻删掉。
 *
 * 行为约定:
 *   - enabled=false 直接返回 { ok: false, reason: "offsite_disabled" } (不算错误)
 *   - 配置不合规返回 { ok: false, reason: "config_invalid", issues: [...] }
 *   - 网络 / 凭据 / 桶权限 失败: 抛 S3Error (caller 自己捕获并返回 502)
 *   - 成功: 返回 { ok: true, probeKey, latencyMs, bucket, region, endpoint }
 */
import { loadOffsiteConfig, validateOffsiteConfigForUse } from "./schema";
import { S3Client, S3Error, randomProbeKey } from "./s3-client";

export type OffsiteDryRunResult =
	| {
			ok: true;
			probeKey: string;
			latencyMs: number;
			bucket: string;
			region: string;
			endpoint: string;
			provider: string;
	  }
	| { ok: false; reason: "offsite_disabled" }
	| { ok: false; reason: "config_invalid"; issues: string[] };

export async function runOffsiteDryRun(): Promise<OffsiteDryRunResult> {
	let config;
	try {
		config = await loadOffsiteConfig();
	} catch (err) {
		return { ok: false, reason: "config_invalid", issues: formatZodIssues(err) };
	}
	if (!config.enabled) {
		return { ok: false, reason: "offsite_disabled" };
	}
	// 使用前校验: 把必填项缺失 / 邮箱格式错等问题在到达 S3Client 之前拦下,
	// 避免 S3Client 构造器抛 S3Error 跟"远端错误"混淆。
	const issues = validateOffsiteConfigForUse(config);
	if (issues.length > 0) {
		return { ok: false, reason: "config_invalid", issues };
	}
	const client = new S3Client({
		endpoint: config.endpoint,
		region: config.region,
		bucket: config.bucket,
		accessKeyId: config.accessKeyId,
		secretAccessKey: config.secretAccessKey,
	});
	const probeKey = `${config.pathPrefix}${randomProbeKey("_probe/")}`;
	const payload = `vcontrolhub-offsite-probe:${new Date().toISOString()}`;
	const start = Date.now();
	try {
		await client.putObject(probeKey, payload, "text/plain");
		await client.headObject(probeKey);
		await client.deleteObject(probeKey);
	} catch (err) {
		if (err instanceof S3Error) {
			throw err;
		}
		throw new S3Error(
			err instanceof Error ? err.message : String(err),
			0,
			"Dry-run failed",
		);
	}
	const latencyMs = Date.now() - start;
	return {
		ok: true,
		probeKey,
		latencyMs,
		bucket: config.bucket,
		region: config.region,
		endpoint: config.endpoint,
		provider: config.provider,
	};
}

function formatZodIssues(err: unknown): string[] {
	if (typeof err === "object" && err !== null && "issues" in err) {
		const issues = (err as { issues?: unknown }).issues;
		if (Array.isArray(issues)) {
			return issues
				.map((i) => {
					if (typeof i === "object" && i !== null && "message" in i) {
						return String((i as { message?: unknown }).message ?? "");
					}
					return String(i);
				})
				.filter(Boolean);
		}
	}
	return [err instanceof Error ? err.message : String(err)];
}
