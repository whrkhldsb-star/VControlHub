import { getLockKeys } from "@/lib/concurrency/advisory-lock";
import { assertAnnouncementWindow } from "@/lib/announcement/service";
import { planAiProviders, planSnippets, ProviderDefaultBusy, writableSetting } from "./import-config-plan";
/**
 * TR-042: 系统配置导入服务 — 配置与内容域导入模块。
 *
 * 包含系统设置、AI 提供者、公告、代码片段的导入逻辑。
 * 从 import-executors.ts 按域拆分而来。
 */

import { Prisma } from "@prisma/client";
import { ZodError } from "zod";

import { resolveDefaultProviderBaseUrl } from "@/lib/ai/provider-endpoint";
import { safeDecryptApiKey } from "@/lib/ai/service-crud";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import { decodeStoredSecret, normalizeStoredSetting, readStoredSecret, toStoredValue } from "@/lib/settings/service";
import { isSensitiveKey } from "@/lib/settings/schema";
import { ValidationError } from "@/lib/errors";
import { OFFSITE_SETTING_KEYS, parseConfigFromMap } from "@/lib/storage/offsite/schema";
import { normalizeEndpoint as normalizeOffsiteEndpoint } from "@/lib/storage/offsite/s3-client";
import { t as translate } from "@/lib/i18n/service-translations";
import { creatorResolver, idsPresent, parseDate, upsertById, type Tx, type Counts } from "./import-executors-helpers";

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
  const records = t.settings.filter((r) => writableSetting(r, exportMode));
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
    if (!options.overwriteExisting && current.has(key)) {
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
      const clearKey = !sameBinding && (!r.apiKey?.trim() || r.apiKey === current.apiKey
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
          enabled: r.enabled && !clearKey && Boolean(r.apiKey || current.apiKey),
          settings: r.settings as Prisma.InputJsonValue,
        },
      });
      counts.updated++;
    } else {
      await tx.aiProvider.create({ data: {
        id: r.id, name: r.name, type: r.type as never, apiKey: r.apiKey ?? "", baseUrl: r.baseUrl,
        defaultModel: r.defaultModel, availableModels: r.availableModels, isDefault: defaults.get(ownerOf(r)) === r.id,
        enabled: r.enabled && Boolean(r.apiKey), settings: r.settings as Prisma.InputJsonValue, createdBy: r.createdBy,
      } });
      counts.created++;
    }
  }
  for (const [createdBy, id] of defaults) {
    await tx.aiProvider.updateMany({ where: { createdBy, isDefault: true, NOT: { id } }, data: { isDefault: false } });
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
  const previous = new Map<string, Date>();
  const toData = (r: ExportFile["tables"]["announcements"][number]) => {
    const startsAt = r.startsAt ? parseDate(r.startsAt, "announcements.startsAt") : previous.get(r.id) ?? new Date();
    const expiresAt = r.expiresAt ? parseDate(r.expiresAt, "announcements.expiresAt") : null;
    assertAnnouncementWindow(startsAt, expiresAt);
    return { title: r.title, body: r.body, level: r.level, pinned: r.pinned, published: r.published, startsAt, expiresAt, createdBy: creator(r.createdBy) };
  };
  await upsertById(t.announcements, options, counts, {
    listExistingIds: async (ids) => {
      const rows = await tx.announcement.findMany({ where: { id: { in: ids } }, select: { id: true, startsAt: true } });
      for (const row of rows) previous.set(row.id, row.startsAt);
      return new Set(previous.keys());
    },
    createManySkipDuplicates: async (rows) => (await tx.announcement.createMany({
      data: rows.map((r) => ({ id: r.id, ...toData(r) })), skipDuplicates: true,
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
    const { id, createdAt: _createdAt, ...data } = row;
    if (action === "create") creates.push({ id, ...data });
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
