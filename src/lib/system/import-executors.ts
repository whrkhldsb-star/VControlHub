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
 * 依赖顺序（导入前先按业务键对齐 ID，见 import-id-alignment）：
 *  Permission → Role → RolePermission
 *  → Team → IdentityTemplate
 *  → User → UserRole → TeamMember
 *  → SshKey → Server → UserServerAccess
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
export * from "./import-executors-tenancy";

// ── executeImport 编排函数 ───────────────────────────────

import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import type { Counts, ImportResult, Tx } from "./import-executors-helpers";
import { ProviderDefaultBusy } from "./import-config-plan";
import {
  assertImportHasActiveAdmin,
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
import { importIdentityTemplates, importTeamMembers, importTeams, importUserServerAccess } from "./import-executors-tenancy";
import { alignImportIds, findMissingTeamIds } from "./import-id-alignment";
import { ValidationError } from "@/lib/errors";
import { t as translate } from "@/lib/i18n/service-translations";

/**
 * 按依赖顺序事务性导入所有配置表。
 * 整个导入在一个 Prisma 事务中完成，任一步骤失败则全部回滚。
 */
export async function executeImport(
  file: ExportFile,
  options: ImportOptions,
): Promise<ImportResult> {
  // Large multi-table imports easily exceed Prisma's default 5s interactive
  // transaction timeout (P2028). Give operators a realistic window.
  const write = async (tx: Tx) => {
    const counts: Counts = { created: 0, updated: 0, skipped: 0 };
    // LOCK is a utility command and precedes the first snapshot-taking SELECT.
    // An ordinary provider writer can otherwise commit a new default between
    // our serializable snapshot and its owner's advisory lock. Its new row
    // would then be invisible to the demotion, even after we acquired the lock.
    if (file.tables.aiProviders.some((row) => row.isDefault)) {
      await tx.$executeRaw`LOCK TABLE ai_providers IN SHARE ROW EXCLUSIVE MODE`;
    }
    await lockForTransaction(tx, "user-admin-invariant", "global");
    // 0. Take this instance's ids for objects it already has under the same
    //    business key, and refuse references to customers that exist nowhere.
    const t = await alignImportIds(tx, file.tables);
    const missingTeams = await findMissingTeamIds(tx, t, options.overwriteExisting);
    if (missingTeams.length > 0) {
      throw new ValidationError(translate("backend.system.importMissingCustomers", { ids: missingTeams.slice(0, 5).join(", "), count: missingTeams.length }));
    }
    // 1. Permissions
    await importPermissions(tx, t, options, counts);
    // 2. Roles
    await importRoles(tx, t, options, counts);
    // 3. RolePermissions
    await importRolePermissions(tx, t, options, counts);
    // 3a. Customers and identity templates
    await importTeams(tx, t, options, counts);
    await importIdentityTemplates(tx, t, options, counts);
    // 4. Users (可选)
    await importUsers(tx, t, options, counts, file.exportMode);
    // 5. UserRoles
    await importUserRoles(tx, t, options, counts);
    // 5a. Customer memberships
    await importTeamMembers(tx, t, options, counts);
    // 6. SshKeys
    await importSshKeys(tx, t, options, counts);
    // 7. Servers
    await importServers(tx, t, options, counts, file.exportMode);
    // 7a. Per-server permissions
    await importUserServerAccess(tx, t, options, counts);
    // 8. StorageNodes
    await importStorageNodes(tx, t, options, counts);
    // 9. UserStorageAccess
    await importUserStorageAccess(tx, t, options, counts);
    // 10. CommandTemplates
    await importCommandTemplates(tx, t, options, counts);
    // 11. QuickServices
    await importQuickServices(tx, t, options, counts, file.exportMode);
    // 12. Playbooks
    await importPlaybooks(tx, t, options, counts, file.exportMode);
    // 13. AlertRules
    await importAlertRules(tx, t, options, counts, file.exportMode);
    // 14. Settings (可选)
    await importSettings(tx, t, options, counts, file.exportMode);
    // 15. AiProviders
    await importAiProviders(tx, t, options, counts);
    // 16. Announcements
    await importAnnouncements(tx, t, options, counts);
    // 17. Snippets
    await importSnippets(tx, t, options, counts);
    await assertImportHasActiveAdmin(tx);
    return counts;
  };

  try {
    for (let attempt = 1; ; attempt++) {
      try {
        const counts = await prisma.$transaction(write, { timeout: 120_000, maxWait: 20_000, isolationLevel: "Serializable" });
        return { ...counts, errors: [] };
      } catch (error) {
        if (!(error instanceof ProviderDefaultBusy) || attempt >= 3) throw error;
        // Let the normal editor commit before taking the next import snapshot.
        await prisma.$transaction((tx) => lockForTransaction(tx, "ai-provider-default", error.owner), { timeout: 120_000 });
      }
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const skipped = Object.values(file.tables).reduce((total, rows) => total + rows.length, 0);
    return { created: 0, updated: 0, skipped, errors: [`Transaction failed: ${msg}`], rolledBack: true };
  }
}
