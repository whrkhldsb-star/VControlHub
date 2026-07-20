/**
 * TR-007 M03: 异地备份 service — 高层封装 (load / save / dry-run / status)。
 *
 * 单独成模块, 让 API routes 只需 import `from "@/lib/storage/offsite/service"` 即可。
 */
export {
	loadOffsiteConfig,
	saveOffsiteConfig,
	parseConfigFromMap,
	isOffsiteEnabled,
	OFFSITE_SETTING_KEYS,
	OFFSITE_PROVIDER_VALUES,
	OffsiteConfigSchema,
	type OffsiteConfig,
	type OffsiteConfigUpdate,
	type OffsiteProvider,
} from "./schema";

export {
	runOffsiteDryRun,
	type OffsiteDryRunResult,
} from "./dry-run";

export { S3Client, S3Error, randomProbeKey } from "./s3-client";
export type { S3ClientConfig, S3Object, S3ListResult } from "./s3-client";

export { pruneOffsiteObjects, type OffsitePruneSummary } from "./retention";
