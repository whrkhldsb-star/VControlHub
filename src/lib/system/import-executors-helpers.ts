/**
 * TR-042: 系统配置导入服务 — 共享类型与工具函数。
 *
 * 从 import-executors.ts 拆分而来，供各域模块共享。
 */

import { Prisma } from "@prisma/client";

import { ValidationError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";

// ── 类型与工具函数 ──────────────────────────────────────

/** Prisma 事务客户端类型（$transaction 回调中的 tx） */
export type Tx = Prisma.TransactionClient;

/** 导入计数器，在各 helper 间共享并累加 */
export type Counts = { created: number; updated: number; skipped: number };

/** 导入结果 */
export type ImportResult = {
  created: number;
  updated: number;
  skipped: number;
  errors: string[];
  rolledBack?: boolean;
};

/**
 * Parse a timestamp out of an uploaded bundle.
 *
 * `config-schema` types these fields as a plain `z.string()`, so an unparsable
 * value used to reach Prisma as `Invalid Date` and surface as a cryptic
 * driver-level failure with no indication of which field was wrong. Reject it
 * here instead — the whole import runs in one transaction, so a throw rolls
 * everything back and the operator gets the field name.
 */
export function parseDate(s: string, field = "date"): Date {
  const parsed = new Date(s);
  if (Number.isNaN(parsed.getTime())) {
    throw new ValidationError(
      t("backend.system.importInvalidDate", { field, value: s }),
    );
  }
  return parsed;
}

/**
 * Parse a byte count (storage quotas and per-file size caps) out of an uploaded
 * bundle.
 *
 * This used to swallow an unparsable value and return `null`, which for
 * `quotaBytes` / `maxFileBytes` means "no limit" — so a bundle carrying a
 * human-written `"10 GB"` silently granted unlimited storage instead of failing.
 * A limit must never fail open: an unparsable or negative value aborts the
 * import. `null` and `""` still mean "no limit was set", which is a legitimate
 * value the export itself produces.
 */
export function parseBigInt(s: string | null, field = "size"): bigint | null {
  if (s === null || s === "") return null;
  let parsed: bigint;
  try {
    parsed = BigInt(s);
  } catch {
    throw new ValidationError(
      t("backend.system.importInvalidByteCount", { field, value: s }),
    );
  }
  if (parsed < BigInt(0)) {
    throw new ValidationError(
      t("backend.system.importInvalidByteCount", { field, value: s }),
    );
  }
  return parsed;
}
