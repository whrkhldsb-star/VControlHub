/**
 * TR-042: 系统配置导入服务 — 配置与内容域导入模块。
 *
 * 包含系统设置、AI 提供者、公告、代码片段的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { parseDate } from "./import-executors-helpers";
import type { Tx, Counts } from "./import-executors-helpers";

// 14. Settings (可选，key-based where，敏感 key 空值不覆盖)
export async function importSettings(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  if (!options.importSettings) {
    counts.skipped += t.settings.length;
    return;
  }
  const records = t.settings;
  if (records.length === 0) return;
  const keys = records.map((r) => r.key);
  const existing = await tx.setting.findMany({
    where: { key: { in: keys } },
    select: { key: true },
  });
  const existingKeys = new Set(existing.map((e) => e.key));
  const toCreate = records.filter((r) => !existingKeys.has(r.key));
  const toUpdate = records.filter((r) => existingKeys.has(r.key));

  if (toCreate.length > 0) {
    const result = await tx.setting.createMany({
      data: toCreate.map((r) => ({ key: r.key, value: r.value })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      // 敏感 key（空值）不覆盖
      if (r.value !== "") {
        await tx.setting.update({
          where: { key: r.key },
          data: { value: r.value },
        });
        counts.updated++;
      } else {
        counts.skipped++;
      }
    }
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 15. AiProviders (FK try/catch on create → pre-filter FK validity for createdBy)
export async function importAiProviders(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.aiProviders;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.aiProvider.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.aiProvider.update({
        where: { id: r.id },
        data: {
          name: r.name,
          type: r.type as never,
          // Full mode: restore apiKey; Standard: keep existing
          ...(r.apiKey ? { apiKey: r.apiKey } : {}),
          baseUrl: r.baseUrl,
          defaultModel: r.defaultModel,
          availableModels: r.availableModels,
          isDefault: r.isDefault,
          enabled: r.enabled,
          settings: r.settings as Prisma.InputJsonValue,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }

  if (toCreate.length === 0) return;

  // Pre-filter FK validity (createdBy → User) — original used try/catch per record
  const createdByIds = [...new Set(toCreate.map((r) => r.createdBy))];
  const validUsers = await tx.user.findMany({
    where: { id: { in: createdByIds } },
    select: { id: true },
  });
  const validUserIds = new Set(validUsers.map((u) => u.id));
  const validToCreate = toCreate.filter((r) => validUserIds.has(r.createdBy));
  // FK 不存在 → skip
  counts.skipped += toCreate.length - validToCreate.length;

  if (validToCreate.length > 0) {
    const result = await tx.aiProvider.createMany({
      data: validToCreate.map((r) => ({
        id: r.id,
        name: r.name,
        type: r.type as never,
        apiKey: r.apiKey ?? "",
        baseUrl: r.baseUrl,
        defaultModel: r.defaultModel,
        availableModels: r.availableModels,
        isDefault: r.isDefault,
        enabled: r.enabled,
        settings: r.settings as Prisma.InputJsonValue,
        createdBy: r.createdBy,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
    counts.skipped += validToCreate.length - result.count;
  }
}

// 16. Announcements
export async function importAnnouncements(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.announcements;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.announcement.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.announcement.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        title: r.title,
        body: r.body,
        level: r.level,
        pinned: r.pinned,
        published: r.published,
        startsAt: r.startsAt ? parseDate(r.startsAt) : new Date(),
        expiresAt: r.expiresAt ? parseDate(r.expiresAt) : null,
        createdBy: r.createdBy,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.announcement.update({
        where: { id: r.id },
        data: {
          title: r.title,
          body: r.body,
          level: r.level,
          pinned: r.pinned,
          published: r.published,
          startsAt: r.startsAt ? parseDate(r.startsAt) : undefined,
          expiresAt: r.expiresAt ? parseDate(r.expiresAt) : null,
          createdBy: r.createdBy,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}

// 17. Snippets
export async function importSnippets(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const records = t.snippets;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const existing = await tx.snippet.findMany({
    where: { id: { in: ids } },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((e) => e.id));
  const toCreate = records.filter((r) => !existingIds.has(r.id));
  const toUpdate = records.filter((r) => existingIds.has(r.id));

  if (toCreate.length > 0) {
    const result = await tx.snippet.createMany({
      data: toCreate.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        language: r.language,
        content: r.content,
        tags: r.tags,
        isPrivate: r.isPrivate,
        createdBy: r.createdBy,
      })),
      skipDuplicates: true,
    });
    counts.created += result.count;
  }

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      await tx.snippet.update({
        where: { id: r.id },
        data: {
          title: r.title,
          description: r.description,
          language: r.language,
          content: r.content,
          tags: r.tags,
          isPrivate: r.isPrivate,
          createdBy: r.createdBy,
        },
      });
    }
    counts.updated += toUpdate.length;
  } else {
    counts.skipped += toUpdate.length;
  }
}
