/**
 * TR-042: 系统配置导入服务 — 自动化域导入模块。
 *
 * 包含命令模板、快捷服务、Playbook、告警规则的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { creatorResolver, upsertById, type Tx, type Counts } from "./import-executors-helpers";
import { byId, loadGrantUserScopes, loadImportReferences, planAlertRuleImport, quickServiceTarget } from "./import-reference-scope";
import { planQuickServiceImport } from "./import-quick-services";
import { computeNextPlaybookCronRun, isCronTriggerConfig } from "@/lib/playbook/trigger-utils";

// 10. CommandTemplates
export async function importCommandTemplates(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const creator = await creatorResolver(tx, t.commandTemplates.map((r) => r.createdById));
  const toData = (r: ExportFile["tables"]["commandTemplates"][number]) => ({
    name: r.name,
    description: r.description,
    command: r.command,
    rollbackCommand: r.rollbackCommand,
    variables: r.variables,
    tags: r.tags,
    isBuiltin: r.isBuiltin,
    createdById: creator(r.createdById),
    // Multi-tenant: preserve export teamId (null stays legacy-shared)
    teamId: r.teamId ?? null,
  });
  await upsertById(t.commandTemplates, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.commandTemplate.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.commandTemplate.createMany({
          data: rows.map((r) => ({ id: r.id, ...toData(r) })),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.commandTemplate.update({ where: { id: r.id }, data: toData(r) });
    },
  });
}

// 11. QuickServices
export async function importQuickServices(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  // Create resets runtime state (never restore it from a config package);
  // update leaves the running container untouched.
  const toCreateData = (r: ExportFile["tables"]["quickServices"][number]) => ({
    id: r.id,
    slug: r.slug,
    name: r.name,
    category: r.category,
    icon: r.icon,
    description: r.description,
    image: r.image,
    port: r.port,
    path: r.path,
    internalPort: r.internalPort,
    extraPortsJson: r.extraPortsJson,
    command: r.command,
    envJson: r.envJson,
    volumesJson: r.volumesJson,
    // Multi-instance: preserve target (hub-host default if absent)
    ...quickServiceTarget(r),
    // Never restore live runtime state from config package
    status: "stopped",
  });
  const toUpdateData = (r: ExportFile["tables"]["quickServices"][number]) => ({
    slug: r.slug,
    name: r.name,
    category: r.category,
    icon: r.icon,
    description: r.description,
    image: r.image,
    port: r.port,
    path: r.path,
    internalPort: r.internalPort,
    extraPortsJson: r.extraPortsJson,
    command: r.command,
    // A standard (redacted) package writes "{}"/"[]" in place of the secrets
    // and mounts (export-collectors); importing it over a live instance wiped
    // every service's tokens and volumes (A9-01). Like server passwords and AI
    // keys: not in the package means keep ours.
    ...(r.envJson && r.envJson !== "{}" ? { envJson: r.envJson } : {}),
    ...(r.volumesJson && r.volumesJson !== "[]" ? { volumesJson: r.volumesJson } : {}),
    ...quickServiceTarget(r),
  });
  const records = t.quickServices;
  const targets = records.flatMap((row) => row.serverId ? [row.serverId] : []);
  const servers = new Set((await loadImportReferences(targets, (ids) => tx.server.findMany({
    where: { id: { in: ids } }, select: { id: true },
  }))).map((row) => row.id));
  const plan = await planQuickServiceImport(tx, records, options, servers);
  const creates = plan.filter(({ action }) => action === "create").map(({ row }) => toCreateData(row));
  if (creates.length > 0) {
    const result = await tx.quickService.createMany({ data: creates, skipDuplicates: true });
    counts.created += result.count;
    counts.skipped += creates.length - result.count;
  }
  for (const { row, action } of plan) {
    if (action !== "update") continue;
    await tx.quickService.update({ where: { id: row.id }, data: toUpdateData(row) });
    counts.updated += 1;
  }
  counts.skipped += records.length - plan.length;
}

// 12. Playbooks
export async function importPlaybooks(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const creator = await creatorResolver(tx, t.playbooks.map((r) => r.createdById));
  const toData = (r: ExportFile["tables"]["playbooks"][number]) => ({
    name: r.name,
    description: r.description,
    triggerType: r.triggerType,
    triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
    steps: r.steps as Prisma.InputJsonValue,
    chainRetry: r.chainRetry,
    enabled: r.enabled,
    createdById: creator(r.createdById),
    // Multi-tenant: preserve export teamId (null stays legacy-shared)
    teamId: r.teamId ?? null,
  });
  await upsertById(t.playbooks, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.playbook.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.playbook.createMany({
          data: rows.map((r) => ({ id: r.id, ...toData(r) })),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      const before = await tx.playbook.findUnique({
        where: { id: r.id },
        select: { triggerType: true, triggerConfig: true, enabled: true },
      });
      const triggerChanged = !before
        || before.triggerType !== r.triggerType
        || JSON.stringify(before.triggerConfig) !== JSON.stringify(r.triggerConfig);
      // The schedule state derives from the trigger, as an edit recomputes it:
      // an overwritten cron kept its old nextRunAt (months away) and the
      // startup sweep only fills a missing one.
      await tx.playbook.update({
        where: { id: r.id },
        data: {
          ...toData(r),
          ...(triggerChanged || before?.enabled !== r.enabled ? { nextRunAt: nextPlaybookRunAt(r) } : {}),
          ...(triggerChanged ? { metricMatchState: Prisma.DbNull } : {}),
        },
      });
    },
  });
}

function nextPlaybookRunAt(r: { enabled: boolean; triggerType: string; triggerConfig: unknown }): Date | null {
  if (!r.enabled || r.triggerType !== "cron" || !isCronTriggerConfig(r.triggerConfig)) return null;
  try {
    return computeNextPlaybookCronRun(r.triggerConfig.expression);
  } catch {
    // An invalid expression never runs; the trigger sweep reports it.
    return null;
  }
}

// 13. AlertRules
export async function importAlertRules(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
  exportMode?: ExportFile["exportMode"],
): Promise<void> {
  const toData = (r: ExportFile["tables"]["alertRules"][number]) => ({
    name: r.name,
    metric: r.metric,
    operator: r.operator,
    threshold: r.threshold,
    durationSeconds: r.durationSeconds,
    serverIds: r.serverIds,
    notifyChannels: r.notifyChannels,
    playbookIds: r.playbookIds ?? [],
    webhookUrl: r.webhookUrl,
    cooldownMinutes: r.cooldownMinutes,
    silenceWindows: r.silenceWindows,
    escalationMinutes: r.escalationMinutes ?? 30,
    onCallUserIds: r.onCallUserIds ?? [],
    enabled: r.enabled,
    // Multi-tenant: preserve export teamId (null stays legacy-shared)
    teamId: r.teamId ?? null,
  });
  const records = t.alertRules;
  const [servers, playbooks, users] = await Promise.all([
    loadImportReferences(records.flatMap((r) => r.serverIds), (ids) => tx.server.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })).then(byId),
    loadImportReferences(records.flatMap((r) => r.playbookIds ?? []), (ids) => tx.playbook.findMany({
      where: { id: { in: ids } }, select: { id: true, teamId: true },
    })).then(byId),
    loadGrantUserScopes(tx, records.flatMap((r) => r.onCallUserIds ?? [])),
  ]);
  const plan = await planAlertRuleImport(tx, records, options, servers, playbooks, users);
  const creates = plan.filter(({ action }) => action === "create").map(({ row }) => ({ id: row.id, ...toData(row) }));
  if (creates.length > 0) {
    const result = await tx.alertRule.createMany({ data: creates, skipDuplicates: true });
    counts.created += result.count;
    counts.skipped += creates.length - result.count;
  }
  for (const { row, action } of plan) {
    if (action !== "update") continue;
    // A standard export leaves webhook addresses out: keep the address the rule has.
    const { webhookUrl, ...rest } = toData(row);
    await tx.alertRule.update({ where: { id: row.id }, data: exportMode === "full" || webhookUrl ? { ...rest, webhookUrl } : rest });
    counts.updated += 1;
  }
  counts.skipped += records.length - plan.length;
}
