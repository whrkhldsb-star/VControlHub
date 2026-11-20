import type { OffsiteConfig } from "./schema";

/** Non-secret S3 namespace at upload. The key already contains its prefix. */
export function offsiteDestination(config: Pick<OffsiteConfig, "provider" | "endpoint" | "region" | "bucket">) {
  return JSON.stringify([config.provider, config.endpoint.replace(/\/+$/, ""), config.region, config.bucket]);
}
