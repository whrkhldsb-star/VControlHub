// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

import { decrypt, encrypt } from "@/lib/crypto/service";
import { ValidationError } from "@/lib/errors";
import { getAllSettingsMasked } from "@/lib/settings/service";
import { isSensitiveKey } from "@/lib/settings/schema";
import { exportFileSchema, type ExportFile } from "../config-schema";
import { exportPlaybooks, exportSettings } from "../export-collectors";
import { importAlertRules, importPlaybooks, importQuickServices } from "../import-executors-automation";
import { importAiProviders, importSettings } from "../import-executors-config";
import type { Tx } from "../import-executors-helpers";

const prisma = vi.hoisted(() => ({
  setting: { findMany: vi.fn() }, playbook: { findMany: vi.fn() },
}));
vi.mock("@/lib/db", () => ({ prisma }));
beforeEach(() => vi.clearAllMocks());

const options = { dryRun: false, importSettings: true, importUsers: true, overwriteExisting: true };
const counts = () => ({ created: 0, updated: 0, skipped: 0 });

function tables(partial: Record<string, unknown>) {
  return partial as ExportFile["tables"];
}

describe("AI provider credentials", () => {
  const current = { id: "provider", type: "OPENAI", createdBy: "operator", baseUrl: "https://ai.test/v1", apiKey: "stored-envelope" };

  async function write(patch: Record<string, unknown>, mode?: "full" | "standard") {
    const update = vi.fn().mockResolvedValue({});
    const tx = { aiProvider: { findMany: vi.fn().mockResolvedValue([current]), update } } as unknown as Tx;
    await importAiProviders(tx, tables({ aiProviders: [{ ...current, enabled: true, apiKey: null, ...patch }] }), options, counts(), mode);
    return update.mock.calls[0]![0];
  }
  it.each([{ createdBy: "another" }, { type: "CUSTOM" }, { baseUrl: "https://ai.test:8443/v1" },
    { baseUrl: "https://other.test", apiKey: current.apiKey }])("clears and disables on a changed binding %j", async (patch) => {
    expect(await write(patch)).toMatchObject({
      where: { id: current.id, type: current.type, baseUrl: current.baseUrl, createdBy: current.createdBy },
      data: { apiKey: "", enabled: false },
    });
  });
  it("honors full key removal and the target instance's keyless Ollama policy", async () => {
    vi.stubEnv("AI_PROVIDER_PRIVATE_HOSTS", "ollama.test");
    try {
      for (const apiKey of ["", null]) {
        expect((await write({ apiKey }, "full")).data).toMatchObject({ apiKey: "", enabled: false });
        expect((await write({ apiKey, baseUrl: "http://ollama.test:11434/v1", type: "OPENAI_COMPATIBLE" }, "full")).data).toMatchObject({ apiKey: "", enabled: true });
      }
      expect((await write({ apiKey: undefined }, "full")).data).not.toHaveProperty("apiKey");
    } finally {
      vi.unstubAllEnvs();
    }
  });
  it("keeps the existing key on the same effective origin and accepts an explicit replacement", async () => {
    const same = await write({ baseUrl: "https://AI.TEST:443/v2" });
    expect(same.data).not.toHaveProperty("apiKey");
    expect(same.data.enabled).toBe(true);
    expect((await write({ baseUrl: "https://other.test", apiKey: "replacement" })).data).toMatchObject({ apiKey: "replacement", enabled: true });
    expect((await write({ baseUrl: "https://other.test", apiKey: encrypt(current.apiKey) })).data).toMatchObject({ apiKey: "", enabled: false });
  });
});

describe("quick services and alert rules", () => {
  it.each([
    ["hub-host", null, "b", "b"], ["a", "a", "hub-host", null], ["a", "a", "b", "b"],
    ["b", "legacy-wrong-server", "b", "b"],
  ])("skips a QuickService moving from %s/%s to %s/%s", async (oldKey, oldId, instanceKey, serverId) => {
    const update = vi.fn();
    const tx = { quickService: { findMany: vi.fn().mockResolvedValue([{ id: "q", slug: "app", instanceKey: oldKey, serverId: oldId }]), update },
      server: { findMany: vi.fn().mockResolvedValue([{ id: "b" }]) } } as unknown as Tx;
    const result = counts();
    await importQuickServices(tx, tables({ quickServices: [{ id: "q", slug: "app", instanceKey, serverId, envJson: "{}", volumesJson: "[]" }] }), options, result);
    expect(update).not.toHaveBeenCalled();
    expect(result.skipped).toBe(1);
  });
  it("keeps env and mounts when updating a service on its original target", async () => {
    const target = { instanceKey: "a", serverId: "a" };
    const row = { id: "q", slug: "app", ...target };
    const update = vi.fn().mockResolvedValue({});
    const tx = { quickService: { findMany: vi.fn().mockResolvedValue([row]), update }, server: { findMany: vi.fn().mockResolvedValue([{ id: "a" }]) } } as unknown as Tx;
    await importQuickServices(tx, tables({ quickServices: [{ ...row, envJson: "{}", volumesJson: "[]" }] }), options, counts());
    expect(update.mock.calls[0]![0].where).toEqual({ id: "q", ...target });
    expect(update.mock.calls[0]![0].data).not.toHaveProperty("envJson");
    expect(update.mock.calls[0]![0].data).not.toHaveProperty("volumesJson");
  });
  it.each(["team-b", null])("denies an alert-rule transfer to %s even with no explicit references", async (teamId) => {
    const update = vi.fn();
    const tx = { alertRule: { findMany: vi.fn().mockResolvedValue([{ id: "rule", teamId: "team-a" }]), update } } as unknown as Tx;
    const result = counts();
    await importAlertRules(tx, tables({ alertRules: [{ id: "rule", teamId, serverIds: [], webhookUrl: null }] }), options, result);
    expect(result.skipped).toBe(1);
    expect(update).not.toHaveBeenCalled();
  });
});

describe("Playbook Webhook export and overwrite", () => {
  const config = { url: "https://hooks.example/secret-path?token=secret-query", headers: { Authorization: "secret-header", "X-Custom": "secret-custom" }, method: "POST", body: "secret-body" };
  const step = { id: "step", name: "Deliver", type: "call_webhook", config };
  const live = { id: "book", name: "Events", description: null, enabled: true, triggerType: "cron", triggerConfig: { expression: "0 1 * * *" },
    chainRetry: 0, teamId: "team-a", createdById: null, createdAt: new Date(), updatedAt: new Date(), steps: [step] };

  async function snapshot() {
    prisma.playbook.findMany.mockResolvedValue([live]);
    const [row] = await exportPlaybooks("standard", "global", null);
    return exportFileSchema.shape.tables.shape.playbooks.parse([row])[0]!;
  }
  it("redacts all URL components, header values and body while keeping a valid importable step", async () => {
    const row = await snapshot();
    expect(JSON.stringify(row.steps)).not.toMatch(/secret-|hooks\.example/);
    expect(row.steps[0]?.config).toMatchObject({ method: "POST", headers: { Authorization: "", "X-Custom": "" }, body: "" });
    expect((await exportPlaybooks("full", "global", null))[0]?.steps).toEqual([step]);
  });
  it.each(["unchanged", "url", "id", "owner", "method", "headers", "body"])("restores secrets only for an unchanged step and endpoint (%s)", async (change) => {
    const row = await snapshot();
    const importedStep = row.steps[0]!;
    if (importedStep.type !== "call_webhook") throw new Error("Expected a Webhook step");
    if (change === "headers") importedStep.config.headers = { Host: "other.example" };
    if (change === "body") importedStep.config.body = "modified";
    const before = { ...live, teamId: change === "owner" ? "team-b" : live.teamId, steps: [
      { ...step, id: change === "id" ? "new-step" : step.id, config: { ...config, method: change === "method" ? "PUT" : config.method,
        url: change === "url" ? "https://hooks.example/different-path" : config.url } },
    ] };
    const update = vi.fn().mockResolvedValue({});
    const tx = { playbook: { findMany: vi.fn().mockResolvedValue([{ id: live.id }]), findUnique: vi.fn().mockResolvedValue(before), update } } as unknown as Tx;
    await importPlaybooks(tx, tables({ playbooks: [row] }), options, counts(), "standard");
    const { data } = update.mock.calls[0]![0];
    expect(data.enabled).toBe(change === "unchanged");
    if (change === "unchanged") expect(data.steps[0].config).toEqual(config);
    else expect(JSON.stringify(data.steps)).not.toMatch(/secret-/);
  });
  it("creates a disabled playbook when its webhook still needs configuration", async () => {
    const row = await snapshot();
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { playbook: { findMany: vi.fn().mockResolvedValue([]), createMany } } as unknown as Tx;
    await importPlaybooks(tx, tables({ playbooks: [row] }), options, counts());
    expect(createMany.mock.calls[0]![0].data[0].enabled).toBe(false);
  });
});

describe("settings import and historical secret masking", () => {
  function importer(current: Record<string, string> = {}) {
    const update = vi.fn().mockResolvedValue({});
    const createMany = vi.fn().mockResolvedValue({ count: 1 });
    const tx = { setting: { findMany: vi.fn().mockResolvedValue(Object.entries(current).map(([key, value]) => ({ key, value }))), update, createMany } } as unknown as Tx;
    return { update, createMany, write: (entries: Record<string, string>, mode: "full" | "standard" = "standard") =>
      importSettings(tx, tables({ settings: Object.entries(entries).map(([key, value]) => ({ key, value })) }), options, counts(), mode) };
  }
  it.each([["password.minLength", "7"], ["password.minLength", "129"], ["retention.auditLogDays", "-1"], ["smtp.port", "65536"],
    ["password.requireNumber", "yes"], ["offsite.enabled", "maybe"]])("refuses invalid %s=%s before persisting", async (key, value) => {
    const db = importer();
    await expect(db.write({ "smtp.host": "mail.test", [key]: value })).rejects.toThrow(ValidationError);
    expect(db.createMany).not.toHaveBeenCalled();
    expect(db.update).not.toHaveBeenCalled();
  });
  it.each(["smtp.host", "smtp.user", "smtp.port"])("requires a new password when the import changes %s", async (key) => {
    const db = importer({ "smtp.host": "a.test", "smtp.port": "587", "smtp.user": "old", "smtp.pass": "existing" });
    for (const password of [{}, { "smtp.pass": "" }, { "smtp.pass": "***" }] as Record<string, string>[]) {
      await expect(db.write({ ...password, [key]: key === "smtp.port" ? "465" : "other" })).rejects.toThrow(/smtp\.pass/);
    }
    expect(db.update).not.toHaveBeenCalled();
  });
  it.each([
    [{ "offsite.endpoint": "https://user:secret-in-url@storage.example" }, { "offsite.retentionDays": "7" }, "offsite.endpoint"],
    [{ "offsite.pathPrefix": "/" }, { "offsite.enabled": "true" }, "offsite.pathPrefix"],
    [{ "offsite.provider": "invalid" }, { "offsite.region": "auto" }, "offsite.provider"],
  ])("validates the merged offsite configuration, exposing only the field name", async (existing, patch, key) => {
    const db = importer(existing as Record<string, string>);
    const write = db.write(patch as Record<string, string>);
    await expect(write).rejects.toThrow(key as string);
    await expect(write).rejects.not.toThrow(/secret-in-url/);
    expect(db.update).not.toHaveBeenCalled();
    expect(db.createMany).not.toHaveBeenCalled();
  });
  it("accepts a partial offsite setting during setup without reading a stored credential", async () => {
    const db = importer({ "offsite.enabled": "false", "offsite.secretAccessKey": "unreadable:legacy:envelope" });
    await db.write({ "offsite.region": "auto" });
    expect(db.createMany).toHaveBeenCalledWith({ data: [{ key: "offsite.region", value: "auto" }], skipDuplicates: true });
  });
  it("encrypts a new password and authenticates full-export envelopes without double encryption", async () => {
    const db = importer({ "smtp.host": "a.test", "smtp.pass": "existing" });
    await db.write({ "smtp.host": "b.test", "smtp.pass": "replacement" });
    const saved = db.update.mock.calls.at(-1)![0].data.value;
    expect(saved).not.toBe("replacement");
    expect(decrypt(saved)).toBe("replacement");
    const fresh = importer();
    await fresh.write({ "telegram.botToken": encrypt("123:token") }, "full");
    expect(decrypt(fresh.createMany.mock.calls[0]![0].data[0].value)).toBe("123:token");
  });
  it("rejects reusing the old password or its ciphertext when changing SMTP endpoints", async () => {
    const current = encrypt("existing");
    const db = importer({ "smtp.host": "a.test", "smtp.pass": current });
    for (const mode of ["standard", "full"] as const) {
      for (const password of ["existing", current]) {
        await expect(db.write({ "smtp.host": "b.test", "smtp.pass": password }, mode)).rejects.toThrow(/smtp\.pass/);
      }
    }
    expect(db.update).not.toHaveBeenCalled();
  });
  it("allows an endpoint change when the old password is a legacy empty envelope", async () => {
    const db = importer({ "smtp.host": "old.example", "smtp.pass": "c2FsdA==:aXY=:dGFn:" });
    await db.write({ "smtp.host": "new.example" });
    expect(db.update).toHaveBeenCalledWith({ where: { key: "smtp.host" }, data: { value: "new.example", updatedBy: null } });
  });
  it("masks plaintext legacy names in the settings API and blanks them in standard exports", async () => {
    const keys = ["offsite.secret-access-key", "offsite.access-key-id", "service.api-token", "service.next-password", "service.signing-secret"];
    const rows = keys.map((key) => ({ key, value: "legacy-plaintext" }));
    prisma.setting.findMany.mockResolvedValue(rows);
    expect(keys.every(isSensitiveKey)).toBe(true);
    expect(isSensitiveKey("password.minLength")).toBe(false);
    const masked = await getAllSettingsMasked();
    expect(keys.map((key) => masked[key])).toEqual(keys.map(() => "***"));
    expect(await exportSettings("standard", "global")).toEqual(keys.map((key) => ({ key, value: "" })));
    expect(await exportSettings("full", "global")).toEqual(rows);
  });
});
