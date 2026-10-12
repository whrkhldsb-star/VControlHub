/**
 * TR-007 M03: 异地备份 service — 高层封装 (load / save / dry-run / status)。
 *
 * 单独成模块, 让 API routes 只需 import `from "@/lib/storage/offsite/service"` 即可。
 */
export { loadOffsiteConfig, saveOffsiteConfig } from "./schema";
