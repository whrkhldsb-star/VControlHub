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

/**
 * Shared id-upsert scaffold for imports keyed by `id` alone (TR: one copy,
 * ~8 former copies across the domain executor modules).
 *
 * Pipeline: existence check by id → createMany with skipDuplicates → on
 * `overwriteExisting`, per-row update (counted as updated), else the existing
 * rows are counted as skipped. All Prisma calls stay in the caller's `ops`
 * closures so each model keeps its own delegate typing and payload shape —
 * same contract as `upsertByIdWithSecondaryUnique` below.
 */
export async function upsertById<TRecord extends { id: string }>(
  records: TRecord[],
  options: { overwriteExisting: boolean },
  counts: Counts,
  ops: {
    listExistingIds(ids: string[]): Promise<Set<string>>;
    createManySkipDuplicates(records: TRecord[]): Promise<number>;
    updateById(record: TRecord): Promise<void>;
  },
): Promise<void> {
  if (records.length === 0) return;

  const existingIds = await ops.listExistingIds(records.map((r) => r.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    counts.created += await ops.createManySkipDuplicates(toCreate);
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await ops.updateById(r);
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

/**
 * Shared id-upsert scaffold for imports whose table has a SECONDARY unique key
 * besides `id` (permission.key, role.key, user.username — TR: three importers
 * used to duplicate these ~45 lines verbatim).
 *
 * Pipeline: existence check by id → drop to-create rows whose secondary key is
 * already taken (counted as skipped) → createMany with skipDuplicates → on
 * `overwriteExisting`, per-row secondary-clash check then update, else the
 * existing rows are counted as skipped. All Prisma calls stay in the caller's
 * `ops` closures so each model keeps its own delegate typing and payload
 * shape; only the control flow and the bookkeeping live here.
 */
export async function upsertByIdWithSecondaryUnique<TRecord extends { id: string }>(
  records: TRecord[],
  options: { overwriteExisting: boolean },
  counts: Counts,
  ops: {
    listExistingIds(ids: string[]): Promise<Set<string>>;
    listTakenSecondaryValues(values: string[]): Promise<Set<string>>;
    secondaryValueOf(record: TRecord): string | undefined;
    createManySkipDuplicates(records: TRecord[]): Promise<number>;
    hasSecondaryClash(record: TRecord): Promise<boolean>;
    updateById(record: TRecord): Promise<void>;
  },
): Promise<void> {
  if (records.length === 0) return;

  const existingIds = await ops.listExistingIds(records.map((r) => r.id));
  let toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    // Secondary unique: only rows carrying a non-empty secondary value compete.
    const values = [
      ...new Set(toCreate.map((r) => ops.secondaryValueOf(r)).filter((value): value is string => Boolean(value))),
    ];
    if (values.length > 0) {
      const taken = await ops.listTakenSecondaryValues(values);
      const skippedSecondary = toCreate.filter((r) => {
        const value = ops.secondaryValueOf(r);
        return value !== undefined && taken.has(value);
      });
      toCreate = toCreate.filter((r) => {
        const value = ops.secondaryValueOf(r);
        return value === undefined || !taken.has(value);
      });
      counts.skipped += skippedSecondary.length;
    }
  }

  if (toCreate.length > 0) {
    counts.created += await ops.createManySkipDuplicates(toCreate);
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      if (await ops.hasSecondaryClash(r)) {
        counts.skipped += 1;
        continue;
      }
      await ops.updateById(r);
      counts.updated += 1;
    }
  } else {
    counts.skipped += toUpdate.length;
  }
}
