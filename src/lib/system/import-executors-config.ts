import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { assertAnnouncementWindow } from "@/lib/announcement/service";
import { planAiProviders, planSnippets, ProviderDefaultBusy, writableSetting } from "./import-config-plan";
/**
 * TR-042: 系统配置导入服务 — 配置与内容域导入模块。
 *
 * 包含系统设置、AI 提供者、公告、代码片段的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { ValidationError } from "@/lib/errors";
import { Prisma } from "@prisma/client";
import { relatedSettingKeys, validateSettingBindings } from "@/lib/settings/bindings";
import { allowsKeylessProvider } from "@/lib/ai/provider-http";

import { resolveDefaultProviderBaseUrl } from "@/lib/ai/provider-endpoint";
import { safeDecryptApiKey } from "@/lib/ai/service-crud";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { decodeStoredSecret, normalizeStoredSetting, readStoredSecret, toStoredValue } from "@/lib/settings/service";
import { isSensitiveKey } from "@/lib/settings/schema";
import { creatorResolver, idsPresent, parseDate, upsertById, type Tx, type Counts } from "./import-executors-helpers";

function importSettingValue(key: string, value: string, full: boolean) {
  if (full && isSensitiveKey(key)) {
    // Full snapshots carry stored envelopes, including the legacy empty
    // envelope. Authenticate ciphertext before re-encrypting for this instance.
    try {
      value = decodeStoredSecret(value);
    } catch {
      throw new ValidationError("IMPORT_SETTING_SOURCE_KEY", { field: key, reason: "systemConfig.import.preview.warning.credentialsNeedSourceKey" });
    }
  }
  return normalizeStoredSetting(key, value);
}

export async function planSettings(tx: Pick<Tx, "setting">, settings: ExportFile["tables"]["settings"], options: ImportOptions, mode?: ExportFile["exportMode"], applied?: Set<string>) {
  const records = options.importSettings ? settings.filter((row) => writableSetting(row, mode)) : [];
  const keys = records.map((row) => row.key);
  const rows = keys.length ? await tx.setting.findMany({
    where: { key: { in: [...new Set([...keys, ...relatedSettingKeys(keys)])] } }, select: { key: true, value: true },
  }) : [];
  const current = new Map(rows.map((row) => [row.key, row.value]));
  const writes = new Map<string, string>();
  const selected = records.filter(({ key }) => options.overwriteExisting || !current.has(key));
  for (const { key } of selected) applied?.add(key);
  for (const { key, value } of selected) {
    writes.set(key, importSettingValue(key, value, mode === "full"));
  }
  validateSettingBindings(current, writes, readStoredSecret);
  return { writes, current };
}

export async function importSettings(
  tx: Tx, t: ExportFile["tables"], options: ImportOptions, counts: Counts, exportMode?: ExportFile["exportMode"],
) {
  const { writes, current } = await planSettings(tx, t.settings, options, exportMode);
  counts.skipped += t.settings.length - writes.size;
  const creates = [];
  for (const [key, value] of writes) {
    const stored = toStoredValue(key, value);
    if (current.has(key)) {
      await tx.setting.update({ where: { key }, data: { value: stored, updatedBy: null } });
      counts.updated++;
    } else {
      creates.push({ key, value: stored });
    }
  }
  if (creates.length) {
    const result = await tx.setting.createMany({ data: creates, skipDuplicates: true });
    counts.created += result.count;
    counts.skipped += creates.length - result.count;
  }
  return [...writes].map(([key, value]) => ({ key, value }));
}

function providerHttpOrigin(baseUrl: string | undefined, type?: string): string | null {
  try {
    const url = new URL(baseUrl?.trim() || resolveDefaultProviderBaseUrl(type));
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.origin : null;
  } catch {
    return null;
  }
}

// 15. AiProviders (FK try/catch on create → pre-filter FK validity for createdBy)
export async function importAiProviders(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
  mode?: ExportFile["exportMode"],
): Promise<void> {
  const records = t.aiProviders;
  if (records.length === 0) return;
  const { plan, existing, defaults, ownerOf } = await planAiProviders(tx, records, options, (ids) =>
    idsPresent(ids, (chunk) => tx.user.findMany({ where: { id: { in: chunk } }, select: { id: true } })));
  counts.skipped += records.length - plan.length;
  for (const owner of defaults.keys()) {
    // Ordinary edits take the user lock before writing this table. Waiting
    // while holding the import's table lock would invert their lock order.
    const { k1, k2 } = getLockKeys("ai-provider-default", owner);
    const [lock] = await tx.$queryRaw<{ acquired: boolean }[]>`SELECT pg_try_advisory_xact_lock(${k1}::int, ${k2}::int) AS acquired`;
    if (!lock?.acquired) throw new ProviderDefaultBusy(owner);
  }
  for (const { row: r, action } of plan) {
    if (action === "update") {
      const current = existing.get(r.id)!;
      const origin = providerHttpOrigin(current.baseUrl, current.type);
      const sameBinding = current.type === r.type && current.createdBy === r.createdBy
        && origin !== null && origin === providerHttpOrigin(r.baseUrl, r.type);
      const clearKey = (mode === "full" && (r.apiKey === null || r.apiKey === "")) || !sameBinding && (!r.apiKey?.trim() || r.apiKey === current.apiKey
        || safeDecryptApiKey(r.apiKey) === safeDecryptApiKey(current.apiKey));
      await tx.aiProvider.update({
        where: { id: r.id, createdBy: current.createdBy, type: current.type, baseUrl: current.baseUrl, updatedAt: current.updatedAt },
        data: {
          name: r.name,
          type: r.type as never,
          ...(clearKey ? { apiKey: "" } : r.apiKey ? { apiKey: r.apiKey } : {}),
          baseUrl: r.baseUrl,
          defaultModel: r.defaultModel,
          availableModels: r.availableModels,
          isDefault: defaults.get(ownerOf(r)) === r.id,
          enabled: r.enabled && (allowsKeylessProvider(r.baseUrl, r.type) || !clearKey && Boolean(r.apiKey || current.apiKey)),
          settings: r.settings as Prisma.InputJsonValue,
        },
      });
      counts.updated++;
    } else {
      await tx.aiProvider.create({ data: {
        id: r.id, name: r.name, type: r.type as never, apiKey: r.apiKey ?? "", baseUrl: r.baseUrl,
        defaultModel: r.defaultModel, availableModels: r.availableModels, isDefault: defaults.get(ownerOf(r)) === r.id,
        enabled: r.enabled && (Boolean(r.apiKey) || allowsKeylessProvider(r.baseUrl, r.type)), settings: r.settings as Prisma.InputJsonValue, createdBy: r.createdBy,
      } });
      counts.created++;
    }
  }
  for (const [createdBy, id] of defaults) {
    await tx.aiProvider.updateMany({ where: { createdBy, isDefault: true, NOT: { id } }, data: { isDefault: false } });
  }
}

// 16. Announcements
export function announcementDates(r: ExportFile["tables"]["announcements"][number], previous?: Date) {
  const startsAt = r.startsAt ? parseDate(r.startsAt, "announcements.startsAt") : previous ?? new Date();
  const expiresAt = r.expiresAt ? parseDate(r.expiresAt, "announcements.expiresAt") : null;
  assertAnnouncementWindow(startsAt, expiresAt);
  return { startsAt, expiresAt };
}

export async function importAnnouncements(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const creator = await creatorResolver(tx, t.announcements.map((r) => r.createdBy));
  const previous = new Map<string, Date>();
  const toData = (r: ExportFile["tables"]["announcements"][number]) => {
    const { startsAt, expiresAt } = announcementDates(r, previous.get(r.id));
    return { title: r.title, body: r.body, level: r.level, pinned: r.pinned, published: r.published, startsAt, expiresAt, createdBy: creator(r.createdBy) };
  };
  await upsertById(t.announcements, options, counts, {
    listExistingIds: async (ids) => {
      const rows = await tx.announcement.findMany({ where: { id: { in: ids } }, select: { id: true, startsAt: true } });
      for (const row of rows) previous.set(row.id, row.startsAt);
      return new Set(previous.keys());
    },
    createManySkipDuplicates: async (rows) => (await tx.announcement.createMany({
      data: rows.map((r) => ({ id: r.id, createdAt: parseDate(r.createdAt, "announcements.createdAt"), ...toData(r) })), skipDuplicates: true,
    })).count,
    updateById: async (r) => {
      await tx.announcement.update({ where: { id: r.id, startsAt: previous.get(r.id) }, data: toData(r) });
    },
  });
}

// 17. Snippets
export async function importSnippets(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
): Promise<void> {
  const plan = await planSnippets(tx, t.snippets, options, (ids) =>
    idsPresent(ids, (chunk) => tx.user.findMany({ where: { id: { in: chunk } }, select: { id: true } })));
  counts.skipped += t.snippets.length - plan.length;
  const creates = [];
  for (const { row, action } of plan) {
    const { id, createdAt, ...data } = row;
    if (action === "create") creates.push({ id, ...data, createdAt: parseDate(createdAt, "snippets.createdAt") });
    else {
      await tx.snippet.update({ where: { id }, data });
      counts.updated++;
    }
  }
  if (creates.length) {
    const { count } = await tx.snippet.createMany({ data: creates, skipDuplicates: true });
    counts.created += count;
    counts.skipped += creates.length - count;
  }
}
