/**
 * TR-042: 系统配置导入服务 — 自动化域导入模块。
 *
 * 包含命令模板、快捷服务、Playbook、告警规则的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import type { Tx, Counts } from "./import-executors-helpers";

// 10. CommandTemplates
export async function importCommandTemplates(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.commandTemplates;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.commandTemplate.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.commandTemplate.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        command: r.command,
        rollbackCommand: r.rollbackCommand,
        variables: r.variables,
        tags: r.tags,
        isBuiltin: r.isBuiltin,
        createdById: r.createdById,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.commandTemplate.update({
        where: { id: r.id },
        data: {
          name: r.name,
          description: r.description,
          command: r.command,
          rollbackCommand: r.rollbackCommand,
          variables: r.variables,
          tags: r.tags,
          isBuiltin: r.isBuiltin,
          createdById: r.createdById,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 11. QuickServices
export async function importQuickServices(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.quickServices;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.quickService.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.quickService.createMany({
      data: toCreate.map((r) => ({
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
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.quickService.update({
        where: { id: r.id },
        data: {
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
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 12. Playbooks
export async function importPlaybooks(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.playbooks;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.playbook.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.playbook.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description,
        triggerType: r.triggerType,
        triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
        steps: r.steps as Prisma.InputJsonValue,
        chainRetry: r.chainRetry,
        enabled: r.enabled,
        createdById: r.createdById,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.playbook.update({
        where: { id: r.id },
        data: {
          name: r.name,
          description: r.description,
          triggerType: r.triggerType,
          triggerConfig: r.triggerConfig as Prisma.InputJsonValue,
          steps: r.steps as Prisma.InputJsonValue,
          chainRetry: r.chainRetry,
          enabled: r.enabled,
          createdById: r.createdById,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 13. AlertRules
export async function importAlertRules(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.alertRules;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.alertRule.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.alertRule.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        name: r.name,
        metric: r.metric,
        operator: r.operator,
        threshold: r.threshold,
        durationSeconds: r.durationSeconds,
        serverIds: r.serverIds,
        notifyChannels: r.notifyChannels,
        webhookUrl: r.webhookUrl,
        cooldownMinutes: r.cooldownMinutes,
        silenceWindows: r.silenceWindows,
        enabled: r.enabled,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.alertRule.update({
        where: { id: r.id },
        data: {
          name: r.name,
          metric: r.metric,
          operator: r.operator,
          threshold: r.threshold,
          durationSeconds: r.durationSeconds,
          serverIds: r.serverIds,
          notifyChannels: r.notifyChannels,
          webhookUrl: r.webhookUrl,
          cooldownMinutes: r.cooldownMinutes,
          silenceWindows: r.silenceWindows,
          enabled: r.enabled,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}
