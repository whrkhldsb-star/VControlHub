/**
 * TR-042: 系统配置导入服务 — 配置与内容域导入模块。
 *
 * 包含系统设置、AI 提供者、公告、代码片段的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { safeDecryptApiKey } from "@/lib/ai/service-crud";
import { isSensitiveSettingKey, type ExportFile, type ImportOptions } from "@/lib/system/config-schema";
import { decodeStoredSecret, isValidSettingKey, normalizeStoredSetting, readStoredSecret, toStoredValue } from "@/lib/settings/service";
import { isSensitiveKey, MASKED_VALUE } from "@/lib/settings/schema";
import { ValidationError } from "@/lib/errors";
import { OFFSITE_SETTING_KEYS, parseConfigFromMap } from "@/lib/storage/offsite/schema";
import { normalizeEndpoint as normalizeOffsiteEndpoint } from "@/lib/storage/offsite/s3-client";
import { t as translate } from "@/lib/i18n/service-translations";
import { creatorResolver, parseDate, upsertById, type Tx, type Counts } from "./import-executors-helpers";

const CREDENTIAL_BINDINGS = [
  { endpoints: ["smtp.host", "smtp.user", "smtp.port", "smtp.requireTls"], secrets: ["smtp.pass"] },
  { endpoints: ["offsite.endpoint", "offsite.provider"], secrets: ["offsite.accessKeyId", "offsite.secretAccessKey"] },
];
const ENDPOINT_DEFAULTS: Record<string, string> = { "smtp.port": "587", "smtp.requireTls": "false", "offsite.provider": "s3" };

function importSettingValue(key: string, value: string, full: boolean) {
  if (full && isSensitiveKey(key)) {
    // Full snapshots carry stored envelopes, including the legacy empty
    // envelope. Authenticate ciphertext before re-encrypting for this instance.
    value = decodeStoredSecret(value);
  }
  return normalizeStoredSetting(key, value);
}

const OFFSITE_PUBLIC_KEYS = OFFSITE_SETTING_KEYS.filter((key) => !isSensitiveKey(key));

function validateImportedOffsite(current: Map<string, string>, writes: Map<string, string>) {
  // Only the effective public fields are needed to validate a partial update.
  // The persisted schema accepts an incomplete configuration during setup.
  const merged: Record<string, string> = {};
  for (const key of OFFSITE_PUBLIC_KEYS) {
    const value = writes.get(key) ?? current.get(key);
    if (value !== undefined) merged[key] = value;
  }
  let config;
  try {
    config = parseConfigFromMap(merged);
  } catch (error) {
    if (!(error instanceof ZodError)) throw error;
    const key = "offsite." + String(error.issues[0]?.path[0] ?? "");
    throw new ValidationError(translate("backend.settings.invalidValue", { key }));
  }
  if (config.endpoint) {
    try {
      normalizeOffsiteEndpoint(config.endpoint);
    } catch {
      throw new ValidationError(translate("backend.settings.invalidValue", { key: "offsite.endpoint" }));
    }
  }
  if (config.enabled && !config.pathPrefix) {
    throw new ValidationError(translate("backend.settings.invalidValue", { key: "offsite.pathPrefix" }));
  }
}

// 14. Settings
export async function importSettings(
  tx: Tx,
  t: ExportFile["tables"],
  options: ImportOptions,
  counts: Counts,
  exportMode?: ExportFile["exportMode"],
): Promise<void> {
  if (!options.importSettings) {
    counts.skipped += t.settings.length;
    return;
  }
  const records = t.settings.filter((r) => isValidSettingKey(r.key));
  counts.skipped += t.settings.length - records.length;
  if (records.length === 0) return;

  const keys = new Set(records.map((r) => r.key));
  if (records.some(({ key }) => key.startsWith("offsite."))) {
    for (const key of OFFSITE_PUBLIC_KEYS) keys.add(key);
  }
  const bindings = CREDENTIAL_BINDINGS.filter(({ endpoints }) => endpoints.some((key) => keys.has(key)));
  for (const binding of bindings) for (const secret of binding.secrets) keys.add(secret);
  if (keys.has("telegram.chatId")) keys.add("telegram.enabled");
  const rows = await tx.setting.findMany({
    where: { key: { in: [...keys] } }, select: { key: true, value: true },
  });
  const current = new Map(rows.map((row) => [row.key, row.value]));
  const writes = new Map<string, string>();
  for (const { key, value } of records) {
    if ((!options.overwriteExisting && current.has(key))
        || (isSensitiveSettingKey(key) && (value === MASKED_VALUE || (value === "" && exportMode !== "full")))) {
      counts.skipped++;
      continue;
    }
    if (writes.has(key)) counts.skipped++;
    writes.set(key, importSettingValue(key, value, exportMode === "full"));
  }

  if ([...writes.keys()].some((key) => key.startsWith("offsite."))) validateImportedOffsite(current, writes);

  // Compare only the effective writes (including creates when overwrite is
  // off). A package may omit the credential row entirely or put it first.
  for (const { endpoints, secrets } of bindings) {
    const changed = endpoints.some((key) => writes.has(key) && writes.get(key) !== (current.get(key) ?? ENDPOINT_DEFAULTS[key] ?? ""));
    if (!changed) continue;
    for (const key of secrets) {
      const stored = current.get(key);
      if (!stored) continue;
      const replacement = writes.get(key);
      if (replacement === "") continue;
      const previous = readStoredSecret(stored);
      if (previous && (replacement === undefined || replacement === stored || replacement === previous)) {
        throw new ValidationError(translate("backend.settings.importCredentialRequired", { key }));
      }
    }
  }
  if (writes.get("telegram.chatId") === "" && (writes.get("telegram.enabled") ?? current.get("telegram.enabled")) === "true") {
    throw new ValidationError(translate("backend.settings.telegramChatIdRequired"));
  }

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
}

function providerHttpOrigin(baseUrl: string): string | null {
  try {
    const url = new URL(baseUrl);
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
): Promise<void> {
  const records = t.aiProviders;
  if (records.length === 0) return;
  const ids = records.map((r) => r.id);
  const select = { id: true, type: true, baseUrl: true, createdBy: true, apiKey: true, updatedAt: true } as const;
  const existing = await tx.aiProvider.findMany({
    where: { id: { in: ids } },
    select,
  });
  const byId = new Map(existing.map((provider) => [provider.id, provider]));
  const toCreate = records.filter((r) => !byId.has(r.id));
  const toUpdate = records.filter((r) => byId.has(r.id));

  if (options.overwriteExisting) {
    for (const r of toUpdate) {
      const current = byId.get(r.id)!;
      const origin = providerHttpOrigin(current.baseUrl);
      const sameBinding = current.type === r.type && current.createdBy === r.createdBy
        && origin !== null && origin === providerHttpOrigin(r.baseUrl);
      const clearKey = !sameBinding && (!r.apiKey?.trim() || r.apiKey === current.apiKey
        || safeDecryptApiKey(r.apiKey) === safeDecryptApiKey(current.apiKey));
      const updated = await tx.aiProvider.update({
        where: { id: r.id, createdBy: current.createdBy, type: current.type, baseUrl: current.baseUrl, updatedAt: current.updatedAt },
        select,
        data: {
          name: r.name,
          type: r.type as never,
          ...(clearKey ? { apiKey: "" } : r.apiKey ? { apiKey: r.apiKey } : {}),
          baseUrl: r.baseUrl,
          defaultModel: r.defaultModel,
          availableModels: r.availableModels,
          isDefault: r.isDefault,
          enabled: r.enabled && !clearKey && Boolean(r.apiKey || current.apiKey),
          settings: r.settings as Prisma.InputJsonValue,
        },
      });
      byId.set(r.id, updated);
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
        enabled: r.enabled && Boolean(r.apiKey),
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
  const creator = await creatorResolver(tx, t.announcements.map((r) => r.createdBy));
  await upsertById(t.announcements, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.announcement.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.announcement.createMany({
          data: rows.map((r) => ({
            id: r.id,
            title: r.title,
            body: r.body,
            level: r.level,
            pinned: r.pinned,
            published: r.published,
            startsAt: r.startsAt ? parseDate(r.startsAt, "announcements.startsAt") : new Date(),
            expiresAt: r.expiresAt ? parseDate(r.expiresAt, "announcements.expiresAt") : null,
            createdBy: creator(r.createdBy),
          })),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.announcement.update({
        where: { id: r.id },
        data: {
          title: r.title,
          body: r.body,
          level: r.level,
          pinned: r.pinned,
          published: r.published,
          startsAt: r.startsAt ? parseDate(r.startsAt, "announcements.startsAt") : undefined,
          expiresAt: r.expiresAt ? parseDate(r.expiresAt, "announcements.expiresAt") : null,
          createdBy: creator(r.createdBy),
        },
      });
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
  const creator = await creatorResolver(tx, t.snippets.map((r) => r.createdBy));
  const toData = (r: ExportFile["tables"]["snippets"][number]) => ({
    title: r.title,
    description: r.description,
    language: r.language,
    content: r.content,
    tags: r.tags,
    isPrivate: r.isPrivate,
    createdBy: creator(r.createdBy),
  });
  await upsertById(t.snippets, options, counts, {
    listExistingIds: async (ids) =>
      new Set(
        (await tx.snippet.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((e) => e.id),
      ),
    createManySkipDuplicates: async (rows) =>
      (
        await tx.snippet.createMany({
          data: rows.map((r) => ({ id: r.id, ...toData(r) })),
          skipDuplicates: true,
        })
      ).count,
    updateById: async (r) => {
      await tx.snippet.update({ where: { id: r.id }, data: toData(r) });
    },
  });
}
