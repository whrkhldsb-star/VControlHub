/**
 * TR-042: 系统配置导入服务 — 自动化域导入模块。
 *
 * 包含命令模板、快捷服务、Playbook、告警规则的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { creatorResolver, upsertById, type Tx, type Counts } from "./import-executors-helpers";
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
    instanceKey:
      (r as { instanceKey?: string | null }).instanceKey ?? "hub-host",
    serverId: (r as { serverId?: string | null }).serverId ?? null,
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
    envJson: r.envJson,
    volumesJson: r.volumesJson,
    instanceKey:
      (r as { instanceKey?: string | null }).instanceKey ?? "hub-host",
    serverId: (r as { serverId?: string | null }).serverId ?? null,
  });
  await upsertById(t.quickServices, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.quickService.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.quickService.createMany({
          data: rows.map(toCreateData),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.quickService.update({ where: { id: r.id }, data: toUpdateData(r) });
    },
  });
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
  await upsertById(t.alertRules, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.alertRule.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.alertRule.createMany({
          data: rows.map((r) => ({ id: r.id, ...toData(r) })),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.alertRule.update({ where: { id: r.id }, data: toData(r) });
    },
  });
}
