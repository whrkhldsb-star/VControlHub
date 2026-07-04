/**
 * TR-042: 系统配置导入服务 — 共享类型与工具函数。
 *
 * 从 import-executors.ts 拆分而来，供各域模块共享。
 */

import { Prisma } from "@prisma/client";

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
};

export function parseDate(s: string): Date {
  return new Date(s);
}

export function parseBigInt(s: string | null): bigint | null {
  if (s === null || s === "") return null;
  try {
    return BigInt(s);
  } catch {
    return null;
  }
}
