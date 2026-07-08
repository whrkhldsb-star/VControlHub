/**
 * TR-042: 系统配置导入服务 — 真实导入模块（事务性 upsert）。
 *
 * 按依赖顺序事务性 upsert，支持 dryRun 预览（不写入）。
 * 敏感字段（passwordHash/privateKey/apiKey 等）在导出时已置 null，
 * 导入后需用户手动重新设置。
 *
 * 原始 1,104 行文件已按域拆分为：
 *   - import-executors-helpers        — 共享类型与工具函数
 *   - import-executors-rbac           — 权限/角色/用户域
 *   - import-executors-infrastructure — SSH密钥/服务器/存储域
 *   - import-executors-automation     — 命令模板/快捷服务/Playbook/告警域
 *   - import-executors-config         — 设置/AI提供者/公告/代码片段域
 *
 * 本文件为 barrel re-export + executeImport 编排函数。
 *
 * 每张表使用 batch findMany + createMany + per-record update
 * 替代 N 次 per-record findUnique + create。
 * N findUnique + N create → 1 findMany + 1 createMany + M updates（M = 已存在数）。
 *
 * 依赖顺序：
 *  Permission → Role → RolePermission
 *  → User → UserRole
 *  → SshKey → Server
 *  → StorageNode → UserStorageAccess
 *  → CommandTemplate → QuickService → Playbook → AlertRule
 *  → Setting → AiProvider → Announcement → Snippet
 */

// ── Barrel re-exports ───────────────────────────────────
export * from "./import-executors-helpers";
export * from "./import-executors-rbac";
export * from "./import-executors-infrastructure";
export * from "./import-executors-automation";
export * from "./import-executors-config";

// ── executeImport 编排函数 ───────────────────────────────

import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import type { Counts, ImportResult } from "./import-executors-helpers";
import {
  importPermissions,
  importRoles,
  importRolePermissions,
  importUsers,
  importUserRoles,
} from "./import-executors-rbac";
import {
  importSshKeys,
  importServers,
  importStorageNodes,
  importUserStorageAccess,
} from "./import-executors-infrastructure";
import {
  importCommandTemplates,
  importQuickServices,
  importPlaybooks,
  importAlertRules,
} from "./import-executors-automation";
import {
  importSettings,
  importAiProviders,
  importAnnouncements,
  importSnippets,
} from "./import-executors-config";

/**
 * 按依赖顺序事务性导入所有配置表。
 * 整个导入在一个 Prisma 事务中完成，任一步骤失败则全部回滚。
 */
export async function executeImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportResult> {
  const t = file.tables;
  const counts: Counts = { created: 0, updated: 0, skipped: 0 };
  const errors: string[] = [];

  await prisma.$transaction(async (tx) => {
    // 1. Permissions
    await importPermissions(tx, t, options, counts);
    // 2. Roles
    await importRoles(tx, t, options, counts);
    // 3. RolePermissions
    await importRolePermissions(tx, t, options, counts);
    // 4. Users (可选)
    await importUsers(tx, t, options, counts);
    // 5. UserRoles
    await importUserRoles(tx, t, options, counts);
    // 6. SshKeys
    await importSshKeys(tx, t, options, counts);
    // 7. Servers
    await importServers(tx, t, options, counts);
    // 8. StorageNodes
    await importStorageNodes(tx, t, options, counts);
    // 9. UserStorageAccess
    await importUserStorageAccess(tx, t, options, counts);
    // 10. CommandTemplates
    await importCommandTemplates(tx, t, options, counts);
    // 11. QuickServices
    await importQuickServices(tx, t, options, counts);
    // 12. Playbooks
    await importPlaybooks(tx, t, options, counts);
    // 13. AlertRules
    await importAlertRules(tx, t, options, counts);
    // 14. Settings (可选)
    await importSettings(tx, t, options, counts);
    // 15. AiProviders
    await importAiProviders(tx, t, options, counts);
    // 16. Announcements
    await importAnnouncements(tx, t, options, counts);
    // 17. Snippets
    await importSnippets(tx, t, options, counts);
  }).catch((err: unknown) => {
    // 事务失败 → 记录错误，不部分提交
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Transaction failed: ${msg}`);
    throw err;
  });

  return { created: counts.created, updated: counts.updated, skipped: counts.skipped, errors };
}
