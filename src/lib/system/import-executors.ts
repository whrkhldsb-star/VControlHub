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

import { acquireAdvisoryLock, lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { prisma } from "@/lib/db";
import { lockSettingBindings, relatedSettingKeys } from "@/lib/settings/bindings";
import { rememberSaved } from "@/lib/settings/service";
import { parseImportFile, type ExportFile, type ImportOptions } from "@/lib/system/config-schema";
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
import { createLogger } from "@/lib/logging";
import { t as translate } from "@/lib/i18n/service-translations";

const importLogger = createLogger("system-import");

function isSerializationConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; meta?: { code?: unknown } };
  return candidate.code === "P2034" || candidate.code === "40001" || candidate.meta?.code === "40001";
}

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
  let stage: keyof ExportFile["tables"] | "validation" | "transaction" = "validation";
  const write = async (tx: Tx) => {
    const counts: Counts = { created: 0, updated: 0, skipped: 0 };
    // LOCK is a utility command and precedes the first snapshot-taking SELECT.
    // An ordinary provider writer can otherwise commit a new default between
    // our serializable snapshot and its owner's advisory lock. Its new row
    // would then be invisible to the demotion, even after we acquired the lock.
    if (file.tables.aiProviders.some((row) => row.isDefault)) {
      await tx.$executeRaw`LOCK TABLE ai_providers IN SHARE ROW EXCLUSIVE MODE`;
    }
    if (options.importSettings && relatedSettingKeys(file.tables.settings.map((row) => row.key)).size) await lockSettingBindings(tx);
    await lockForTransaction(tx, "user-admin-invariant", "global");
    // 0. Take this instance's ids for objects it already has under the same
    //    business key, and refuse references to customers that exist nowhere.
    stage = "users";
    const t = await alignImportIds(tx, file.tables, options.overwriteExisting);
    stage = "teams";
    const missingTeams = await findMissingTeamIds(tx, t, options.overwriteExisting);
    if (missingTeams.length > 0) {
      throw new ValidationError(translate("backend.system.importMissingCustomers", { ids: missingTeams.slice(0, 5).join(", "), count: missingTeams.length }));
    }
    stage = "permissions";
    await importPermissions(tx, t, options, counts);
    stage = "roles";
    await importRoles(tx, t, options, counts);
    stage = "rolePermissions";
    await importRolePermissions(tx, t, options, counts);
    stage = "teams";
    await importTeams(tx, t, options, counts);
    stage = "identityTemplates";
    await importIdentityTemplates(tx, t, options, counts);
    stage = "users";
    await importUsers(tx, t, options, counts, file.exportMode);
    stage = "userRoles";
    await importUserRoles(tx, t, options, counts);
    stage = "teamMembers";
    await importTeamMembers(tx, t, options, counts);
    stage = "sshKeys";
    await importSshKeys(tx, t, options, counts, file.exportMode);
    stage = "servers";
    await importServers(tx, t, options, counts, file.exportMode);
    stage = "userServerAccess";
    await importUserServerAccess(tx, t, options, counts);
    stage = "storageNodes";
    await importStorageNodes(tx, t, options, counts, file.exportMode);
    stage = "userStorageAccess";
    await importUserStorageAccess(tx, t, options, counts);
    stage = "commandTemplates";
    await importCommandTemplates(tx, t, options, counts);
    stage = "quickServices";
    await importQuickServices(tx, t, options, counts, file.exportMode);
    stage = "playbooks";
    await importPlaybooks(tx, t, options, counts, file.exportMode);
    stage = "alertRules";
    await importAlertRules(tx, t, options, counts, file.exportMode);
    stage = "settings";
    const settings = await importSettings(tx, t, options, counts, file.exportMode);
    stage = "aiProviders";
    await importAiProviders(tx, t, options, counts, file.exportMode);
    stage = "announcements";
    await importAnnouncements(tx, t, options, counts);
    stage = "snippets";
    await importSnippets(tx, t, options, counts);
    stage = "users";
    await assertImportHasActiveAdmin(tx);
    return { counts, settings };
  };

  try {
    file = parseImportFile(file);
    stage = "transaction";
    // Acquire the AI Ops settings advisory lock OUTSIDE the Serializable transaction
    // whenever the import can mutate `ai.ops.*` settings or `ai_providers`:
    //   1) `Serializable` takes its snapshot on the first SELECT, so waiting on a
    //      transaction-level advisory lock inside the tx would see a stale snapshot.
    //   2) Acquiring `ai-ops-settings` before `LOCK TABLE ai_providers` matches
    //      `action-executor.ts` (`ai-ops-settings` -> `jobs` -> `ai_providers`),
    //      preventing lock-order inversions while serializing mode/provider switches.
    const needsAiOpsLock =
      (options.importSettings && file.tables.settings.some((row) => row.key.startsWith("ai.ops.")))
      || file.tables.aiProviders.length > 0;
    const releaseAiOpsLock = needsAiOpsLock ? await acquireAdvisoryLock("ai-ops-settings", "global") : null;
    try {
      for (let attempt = 1; ; attempt++) {
        try {
          const { counts, settings } = await prisma.$transaction(write, { timeout: 120_000, maxWait: 20_000, isolationLevel: "Serializable" });
          rememberSaved(settings);
          return { ...counts, errors: [] };
        } catch (error) {
          if (error instanceof ProviderDefaultBusy && attempt < 3) {
            // Let the normal editor commit before taking the next import snapshot.
            await prisma.$transaction((tx) => lockForTransaction(tx, "ai-provider-default", error.owner), { timeout: 120_000 });
            continue;
          }
          if (isSerializationConflict(error) && attempt < 3) {
            continue;
          }
          throw error;
        }
      }
    } finally {
      await releaseAiOpsLock?.();
    }
  } catch (error) {
    importLogger.error("System configuration import failed and rolled back", {
      stage,
      error: error instanceof Error ? error.message : String(error),
    });
    const tables = file && typeof file === "object" && file.tables && typeof file.tables === "object" ? file.tables : null;
    const skipped = tables
      ? Object.values(tables).reduce((total, rows) => total + (Array.isArray(rows) ? rows.length : 0), 0)
      : 0;
    return { created: 0, updated: 0, skipped, errors: [`IMPORT_FAILED.${stage}`], rolledBack: true };
  }
}
