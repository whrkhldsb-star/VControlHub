// @vitest-environment node
import { createHash, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getSetting, setManySettings } from "@/lib/settings/service";
import { getSshEnforceHostKeyPin, primeCachedFlags } from "@/lib/settings/cached-flags";
import { getSnippet } from "@/lib/snippet/service";
import { decryptServerPassword } from "@/lib/ssh/ssh-key-crypto";
import { prisma } from "@/lib/db";
import { lockForTransaction } from "@/lib/concurrency/advisory-lock";
import { EXPORT_SCHEMA_VERSION, exportFileSchema, type ExportFile } from "../config-schema";
import { sshFixture } from "./ssh-fixture";
import { createImportAdmin } from "./import-admin-fixture";
import { executeImport } from "../import-executors";
import { previewImport } from "../import-preview";

type Tables = ExportFile["tables"];
type ServerRow = Tables["servers"][number];

const stamp = "2026-01-01T00:00:00.000Z";
const options = { dryRun: false, overwriteExisting: true, importUsers: true, importSettings: false };

function bundle(tables: Partial<Tables>) {
  return exportFileSchema.parse({
    schemaVersion: EXPORT_SCHEMA_VERSION, exportedAt: stamp, sourceDomain: "import.test",
    tables: {
      permissions: [], roles: [], rolePermissions: [], users: [], userRoles: [],
      sshKeys: [], servers: [], storageNodes: [], userStorageAccess: [], commandTemplates: [],
      quickServices: [], playbooks: [], alertRules: [], settings: [], aiProviders: [], announcements: [], snippets: [],
      ...tables,
    },
  });
}

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("tenant-scoped configuration imports (PostgreSQL)", () => {
  const prefix = `r2-import-${randomUUID().slice(0, 8)}`;
  const id = (name: string) => `${prefix}-${name}`;
  const a = id("team-a");
  const b = id("team-b");
  const template = id("template");
  const userA = id("user-a");
  const userB = id("user-b");
  const moved = id("moved");
  const detached = id("detached");
  const serverA = id("server-a");
  const serverB = id("server-b");
  const nodeA = id("node-a");
  const nodeB = id("node-b");
  const pbA = id("pb-a");
  const pbB = id("pb-b");

  function serverData(id: string, teamId: string, sshKeyId: string | null = null) {
    return { id, teamId, sshKeyId, name: id, host: `${id}.test`, username: "test", port: 22, tags: [] };
  }

  function serverRow(id: string, teamId: string, sshKeyId: string | null): ServerRow {
    return {
      ...serverData(id, teamId, sshKeyId), password: null, description: null, enabled: true,
      connectionType: "SSH_KEY", publicUrl: null, fileProxyPort: 0, osDialect: null, osInfo: null, createdAt: stamp,
    };
  }

  async function comparePreviewAndImport(file: ExportFile, overrides: Partial<typeof options> = {}) {
    const config = { ...options, ...overrides };
    const preview = await previewImport(file, { ...config, dryRun: true });
    const total = Object.values(preview.summary).reduce(
      (sum, row) => ({ created: sum.created + row.create, updated: sum.updated + row.update, skipped: sum.skipped + row.skip }),
      { created: 0, updated: 0, skipped: 0 },
    );
    expect(total.created + total.updated + total.skipped).toBe(Object.values(file.tables).reduce((n, rows) => n + rows.length, 0));
    expect(await executeImport(file, config)).toEqual({ ...total, errors: [] });
    return preview;
  }

  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    await createImportAdmin(id("admin"));
    await prisma.team.createMany({ data: [a, b].map((id) => ({ id, slug: id, name: id })) });
    await prisma.identityTemplate.create({ data: { id: template, name: template, permissions: [] } });
    await prisma.user.createMany({ data: [userA, userB, moved, detached].map((id) => ({ id, username: id, passwordHash: "test" })) });
    await prisma.user.update({ where: { id: moved }, data: { currentTeamId: a } });
    await prisma.teamMember.createMany({ data: [
      { userId: userA, teamId: a }, { userId: userB, teamId: b }, { userId: moved, teamId: a },
    ].map((row) => ({ ...row, identityTemplateId: template })) });
    await prisma.server.createMany({ data: [serverData(serverA, a), serverData(serverB, b)] });
    await prisma.storageNode.createMany({ data: [{ id: nodeA, teamId: a }, { id: nodeB, teamId: b }]
      .map((row) => ({ ...row, name: row.id, driver: "LOCAL", basePath: "/srv" })) });
    await prisma.playbook.createMany({ data: [{ id: pbA, teamId: a }, { id: pbB, teamId: b }].map((row) => ({
      ...row, name: row.id, triggerType: "manual", triggerConfig: {}, steps: [],
    })) });
  });

  afterAll(async () => {
    await prisma.alertRule.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.quickService.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.playbook.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.storageNode.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.server.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.sshKey.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.user.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.snippet.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.commandTemplate.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.role.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.identityTemplate.deleteMany({ where: { id: { startsWith: prefix } } });
    await prisma.team.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
  });

  function account(sourceId: string, username: string) {
    return { id: sourceId, username, displayName: null, passwordHash: null, status: "ACTIVE", mustChangePassword: false,
      twoFactorEnabled: false, twoFactorSecret: null, preferences: null, createdAt: stamp };
  }

  it("checks both customer and administrator identity before writing credentials or private content", async () => {
    const foreign = account(id("source-user"), userB);
    const snippet = { id: id("private"), title: "Private", content: "Private notes", description: null, language: "text",
      tags: [], isPrivate: true, createdBy: foreign.id, createdAt: stamp };
    const file = bundle({ users: [foreign], snippets: [snippet], teamMembers: [
      { teamId: a, userId: foreign.id, joinedAt: stamp, identityTemplateId: template },
    ] });
    await expect(previewImport(file, { ...options, overwriteExisting: false })).rejects.toThrow();
    expect(await executeImport(file, { ...options, overwriteExisting: false })).toMatchObject({ rolledBack: true, created: 0 });
    expect(await prisma.snippet.findUnique({ where: { id: snippet.id } })).toBeNull();
    const admin = await prisma.user.findUniqueOrThrow({ where: { id: id("admin") } });
    const stale = bundle({ users: [{ ...account(admin.id, admin.username), passwordHash: "snapshot-password-hash" }] });
    expect(await executeImport({ ...stale, exportMode: "full" }, options)).toMatchObject({ rolledBack: true });
    expect((await prisma.user.findUniqueOrThrow({ where: { id: admin.id } })).passwordHash).toBe(admin.passwordHash);
  });

  it("keeps shared snippets readable by a colleague after repeat slug-aligned imports", async () => {
    const source = id("source-team");
    const prefixOf = (owner: string) => "sn-team-" + createHash("sha256").update(owner).digest("hex") + "-";
    const snippet = { id: prefixOf(source) + prefix, title: "Shared notes", content: "Team note", language: "text",
      description: null, tags: [], isPrivate: false, createdBy: id("source-author"), createdAt: stamp };
    const file = bundle({ teams: [{ id: source, slug: a, name: a, description: null }],
      users: [account(snippet.createdBy, userA)], teamMembers: [{ userId: snippet.createdBy, teamId: source, identityTemplateId: template, joinedAt: stamp }],
      snippets: [snippet] });
    const target = prefixOf(a) + prefix;
    try {
      await comparePreviewAndImport(file, { overwriteExisting: false });
      await comparePreviewAndImport(file, { overwriteExisting: false });
      expect(await getSnippet(target, { userId: moved, platformAdmin: false, currentTeamId: a })).toMatchObject({
        content: snippet.content, createdBy: userA, createdAt: new Date(stamp),
      });
      await expect(getSnippet(target, { userId: userB, platformAdmin: false, currentTeamId: b })).rejects.toThrow();
    } finally {
      await prisma.snippet.deleteMany({ where: { id: { in: [target, snippet.id] } } });
    }
  });

  it("encrypts legacy credentials, verifies SSH identity, and honors explicit full key removal", async () => {
    const material = sshFixture();
    const row = { ...material, teamId: a, id: id("material"), name: "SSH", passphrase: null, description: null, createdById: userA, createdAt: stamp };
    const server = { ...serverRow(id("legacy-password"), a, null), connectionType: "PASSWORD", password: "sample-login" };
    await comparePreviewAndImport(bundle({ sshKeys: [row], servers: [server] }));
    const saved = await prisma.sshKey.findUniqueOrThrow({ where: { id: row.id } });
    expect(saved.privateKey).toBeTruthy();
    expect(saved.privateKey).not.toContain("PRIVATE KEY");
    const stored = await prisma.server.findUniqueOrThrow({ where: { id: server.id } });
    expect(stored.password).not.toBe(server.password);
    expect(decryptServerPassword(stored.password!)).toBe(server.password);
    const invalid = bundle({ sshKeys: [{ ...row, fingerprint: sshFixture().fingerprint }] });
    expect(await previewImport(invalid, options)).toMatchObject({ totalRecords: 0, issues: [{ table: "sshKeys", blocking: true }] });
    expect((await executeImport(invalid, options)).rolledBack).toBe(true);
    const stripped = bundle({ sshKeys: [{ ...row, publicKey: saved.publicKey, privateKey: null }] });
    await comparePreviewAndImport({ ...stripped, exportMode: "standard" });
    expect((await prisma.sshKey.findUniqueOrThrow({ where: { id: row.id } })).privateKey).toBe(saved.privateKey);
    await comparePreviewAndImport({ ...stripped, exportMode: "full" });
    expect((await prisma.sshKey.findUniqueOrThrow({ where: { id: row.id } })).privateKey).toBeNull();
  });

  it("serializes setting edits with imports and refreshes security flags only after commit", async () => {
    const keys = ["telegram.enabled", "telegram.chatId", "smtp.host", "smtp.pass", "security.sshEnforceHostKeyPin"];
    const old = await prisma.setting.findMany({ where: { key: { in: keys } } });
    try {
      await prisma.setting.deleteMany({ where: { key: { in: keys } } });
      await setManySettings([{ key: "smtp.host", value: "mail.test" }, { key: "smtp.pass", value: "mail-password" },
        { key: "security.sshEnforceHostKeyPin", value: "false" }, { key: "telegram.chatId", value: "100" }]);
      await primeCachedFlags();
      expect(getSshEnforceHostKeyPin()).toBe(false);
      const strict = { key: "security.sshEnforceHostKeyPin", value: "true" };
      const blocked = bundle({ settings: [{ key: "smtp.host", value: "new-mail.test" }, strict] });
      const settingsOptions = { ...options, importSettings: true };
      expect(await previewImport(blocked, settingsOptions)).toMatchObject({ totalRecords: 0, issues: [{ table: "settings", id: "smtp.pass", reason: "backend.settings.importCredentialRequired", blocking: true }] });
      expect((await executeImport(blocked, settingsOptions)).rolledBack).toBe(true);
      expect(getSshEnforceHostKeyPin()).toBe(false);
      expect((await executeImport(bundle({ settings: [strict] }), settingsOptions)).errors).toEqual([]);
      expect(getSshEnforceHostKeyPin()).toBe(true);
      const [enable, clear] = await Promise.allSettled([
        executeImport(bundle({ settings: [{ key: "telegram.enabled", value: "true" }] }), settingsOptions),
        setManySettings([{ key: "telegram.chatId", value: "" }]),
      ]);
      expect(enable.status).toBe("fulfilled");
      const enabled = await getSetting("telegram.enabled") === "true";
      expect(enabled).toBe(clear.status === "rejected");
      expect(!enabled || Boolean(await getSetting("telegram.chatId"))).toBe(true);
    } finally {
      await prisma.setting.deleteMany({ where: { key: { in: keys } } });
      if (old.length) await prisma.setting.createMany({ data: old });
      await primeCachedFlags();
    }
  });

  it("blocks the whole package when a merged announcement window cannot be saved", async () => {
    const row = { id: id("window"), title: "Notice", body: "Maintenance", level: "info", pinned: false, published: true,
      startsAt: null, expiresAt: stamp, createdBy: null, createdAt: stamp };
    await prisma.announcement.create({ data: { id: row.id, title: row.title, body: row.body, startsAt: new Date("2026-03-01Z") } });
    try {
      const file = bundle({ announcements: [row], snippets: [{ id: id("window-note"), title: "Note", content: "text", language: "text",
        tags: [], description: null, createdBy: userA, isPrivate: false, createdAt: stamp }] });
      expect(await previewImport(file, options)).toMatchObject({ totalRecords: 0, issues: [{ table: "announcements", id: row.id, blocking: true }] });
      expect(await executeImport(file, options)).toMatchObject({ created: 0, updated: 0, rolledBack: true });
    } finally {
      await prisma.announcement.delete({ where: { id: row.id } });
    }
  });

  it("skips mismatched and missing Quick Service targets with matching preview counts", async () => {
    const newServer = id("future-server");
    const quick = (name: string, instanceKey?: string, serverId?: string | null) => ({
      id: id(name), slug: id(name), name, instanceKey, serverId, category: "other", icon: "app", description: "",
      image: "example/app", port: 12345, path: "/", internalPort: null, extraPortsJson: "[]", command: null,
      envJson: "{}", volumesJson: "[]", status: "running", createdAt: stamp,
    });
    const local = quick("local");
    const existing = quick("existing", serverA, serverA);
    await prisma.quickService.create({ data: {
      id: existing.id, slug: existing.slug, name: "Original", instanceKey: serverA, serverId: serverA, image: existing.image, port: existing.port,
    } });
    const preview = await comparePreviewAndImport(bundle({
      servers: [serverRow(newServer, a, null)],
      quickServices: [
        local, quick("remote", serverA, serverA), quick("future", newServer, newServer),
        quick("hub-foreign", "hub-host", serverB), quick("remote-null", serverA, null),
        quick("missing", id("missing"), id("missing")), { ...existing, serverId: serverB },
        { ...local, id: id("collision") },
      ],
    }));
    expect(preview.summary["systemConfig.import.preview.table.quickServices"]).toEqual({ create: 3, update: 0, skip: 5 });
    expect(await prisma.quickService.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ name: "Original", serverId: serverA });
    expect(await prisma.quickService.findUniqueOrThrow({ where: { id: local.id } })).toMatchObject({ instanceKey: "hub-host", serverId: null, status: "stopped" });
  });

  it("skips cross-customer server, Playbook and on-call links without widening the alert", async () => {
    const alert = (name: string, links: Partial<Tables["alertRules"][number]> = {}) => ({
      id: id(name), teamId: a, name, operator: "gte", metric: "cpu_usage", threshold: 90, durationSeconds: 0,
      serverIds: [serverA], playbookIds: [pbA], onCallUserIds: [userA], notifyChannels: ["in_app"], webhookUrl: null,
      cooldownMinutes: 5, silenceWindows: [], escalationMinutes: 30, enabled: true, createdAt: stamp, ...links,
    });
    const existing = id("alert-existing");
    await prisma.alertRule.create({ data: {
      id: existing, teamId: a, name: "Original", metric: "cpu_usage", operator: "gte", threshold: 90,
      serverIds: [serverA], playbookIds: [pbA], notifyChannels: ["in_app"],
    } });
    const preview = await comparePreviewAndImport(bundle({
      alertRules: [
        alert("alert-ok"), alert("alert-server", { serverIds: [serverA, serverB] }),
        alert("alert-playbook", { playbookIds: [pbB] }), alert("alert-on-call", { onCallUserIds: [userB] }),
        alert("alert-existing", { serverIds: [], playbookIds: [pbB] }),
      ],
    }));
    expect(preview.summary["systemConfig.import.preview.table.alertRules"]).toEqual({ create: 1, update: 0, skip: 4 });
    expect(await prisma.alertRule.findUniqueOrThrow({ where: { id: existing } })).toMatchObject({ name: "Original", serverIds: [serverA], playbookIds: [pbA] });
    expect(await prisma.alertRule.findUniqueOrThrow({ where: { id: id("alert-ok") } })).toMatchObject({ serverIds: [serverA], playbookIds: [pbA], onCallUserIds: [userA] });
  });

  it("warns for a foreign SSH key on the same instance and revalidates retained bindings", async () => {
    const keyA = id("key-a");
    const keyB = id("key-b");
    await prisma.sshKey.createMany({ data: [{ id: keyA, teamId: a }, { id: keyB, teamId: b }].map((row) => ({
      ...row, name: row.id, fingerprint: row.id, publicKey: "test",
    })) });
    const clear = id("server-discard");
    const retain = id("server-retain");
    const create = id("server-new-wrong-key");
    await prisma.server.createMany({ data: [
      { ...serverData(clear, a, keyB), connectionType: "SSH_KEY" },
      { ...serverData(retain, a, keyA), connectionType: "SSH_KEY" },
    ] });
    const preview = await comparePreviewAndImport(bundle({
      servers: [serverRow(clear, a, keyB), serverRow(retain, a, keyB), serverRow(create, a, keyB)],
    }));
    expect(preview.warnings).toContain("systemConfig.import.preview.warning.serverKeysMissing");
    const keys = await prisma.server.findMany({ where: { id: { in: [clear, retain, create] } }, select: { id: true, sshKeyId: true } });
    expect(new Map(keys.map((row) => [row.id, row.sshKeyId]))).toEqual(new Map([[clear, null], [retain, keyA], [create, null]]));
  });

  it("projects valid membership moves and authorizes both kinds of grants for the final customer", async () => {
    const oldStorage = id("moved-old");
    const newStorage = id("moved-new");
    const foreignUpdate = id("foreign-update");
    await prisma.userServerAccess.createMany({ data: [
      { userId: moved, serverId: serverA, canRead: true }, { userId: moved, serverId: serverB, canRead: false },
      { userId: userA, serverId: serverB, canRead: false },
    ] });
    await prisma.userStorageAccess.createMany({ data: [
      { id: oldStorage, userId: moved, storageNodeId: nodeA }, { id: newStorage, userId: moved, storageNodeId: nodeB },
      { id: foreignUpdate, userId: userA, storageNodeId: nodeA },
    ] });
    const serverGrant = (userId: string, serverId: string) => ({
      userId, serverId, canRead: true, canConnect: true, canManage: false, canFileRead: false, canFileWrite: false, canFileDelete: false,
    });
    const storageGrant = (id: string, userId: string, storageNodeId: string) => ({
      id, userId, storageNodeId, pathPrefix: "", canRead: true, canWrite: true, canDelete: false,
      quotaBytes: null, maxFileBytes: null, createdAt: stamp,
    });
    const file = bundle({
      teamMembers: [
        { userId: moved, teamId: b, identityTemplateId: template, joinedAt: stamp },
        { userId: userA, teamId: b, identityTemplateId: id("missing-template"), joinedAt: stamp },
        { userId: detached, teamId: id("missing-team"), identityTemplateId: template, joinedAt: stamp },
      ],
      userServerAccess: [
        serverGrant(moved, serverA), serverGrant(moved, serverB), serverGrant(userA, serverB),
        serverGrant(userA, serverA), serverGrant(detached, serverA),
      ],
      userStorageAccess: [
        storageGrant(oldStorage, moved, nodeA), storageGrant(newStorage, moved, nodeB),
        storageGrant(foreignUpdate, userA, nodeB), storageGrant(id("foreign-create"), userB, nodeA),
        storageGrant(id("detached-storage"), detached, nodeB),
      ],
    });
    const retain = await previewImport(file, { ...options, dryRun: true, overwriteExisting: false });
    expect(retain.summary["systemConfig.import.preview.table.serverAccess"]).toEqual({ create: 1, update: 0, skip: 4 });
    expect(retain.summary["systemConfig.import.preview.table.storageAccess"]).toEqual({ create: 0, update: 0, skip: 5 });

    const preview = await comparePreviewAndImport(file);
    expect(preview.summary["systemConfig.import.preview.table.teamMembers"]).toEqual({ create: 0, update: 1, skip: 2 });
    expect(preview.summary["systemConfig.import.preview.table.serverAccess"]).toEqual({ create: 2, update: 0, skip: 3 });
    expect(preview.summary["systemConfig.import.preview.table.storageAccess"]).toEqual({ create: 1, update: 0, skip: 4 });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: moved }, include: { teamMembership: true } }))
      .toMatchObject({ currentTeamId: b, teamMembership: { teamId: b } });
    expect(await prisma.userServerAccess.findMany({ where: { userId: moved } })).toEqual([expect.objectContaining({ serverId: serverB, canConnect: true })]);
    expect(await prisma.userStorageAccess.findMany({ where: { userId: moved } })).toEqual([expect.objectContaining({ id: newStorage, storageNodeId: nodeB, canWrite: true })]);
    expect(await prisma.userServerAccess.findUniqueOrThrow({ where: { userId_serverId: { userId: userA, serverId: serverB } } })).toMatchObject({ canRead: false, canConnect: false });
    expect(await prisma.userStorageAccess.findUniqueOrThrow({ where: { id: foreignUpdate } })).toMatchObject({ storageNodeId: nodeA, canWrite: false });
  });

  const tableKey = (name: string) => "systemConfig.import.preview.table." + name;
  const userRow = (id: string, username: string) => ({
    id, username, status: "ACTIVE", displayName: null, passwordHash: null, twoFactorEnabled: false,
    twoFactorSecret: null, mustChangePassword: true, preferences: null, createdAt: stamp,
  });
  const storageRow = (id: string, teamId: string, serverId: string | null) => ({
    id, name: id, teamId, serverId, driver: "SFTP", basePath: "/srv", isDefault: false, directAccessMode: "PROXY",
    publicBaseUrl: null, directAccessExpiresSeconds: 300, host: null, port: null, username: null,
    healthStatus: "UNKNOWN" as const, createdAt: stamp,
  });
  const sshRow = (key: string, author: string) => ({
    id: key, name: key, ...sshFixture(), privateKey: null, passphrase: null,
    description: null, teamId: a, createdById: author, createdAt: stamp,
  });

  it("aligns nested Playbook recipients and SSH authors, and skips steps outside the destination customer", async () => {
    const source = id("source-user");
    const notify = (recipientUserId: string) => ({ id: "notify", name: "Notify", type: "send_notification", config: { recipientUserId, subject: "Status", body: "Done" } });
    const pb = { id: id("mapped-book"), name: "Cron", triggerType: "cron", triggerConfig: { expression: "0 1 * * *" },
      steps: [notify(source)], teamId: a, description: null, createdById: null, chainRetry: 0, enabled: true, createdAt: stamp };
    const key = sshRow(id("mapped-ssh"), source);
    const prior = sshRow(id("existing-ssh"), source);
    await prisma.sshKey.create({ data: { id: prior.id, name: prior.name, publicKey: prior.publicKey, fingerprint: prior.fingerprint, teamId: a, createdById: userB } });
    const preview = await comparePreviewAndImport(bundle({ users: [userRow(source, userA)], teamMembers: [{ userId: source, identityTemplateId: template, teamId: a, joinedAt: stamp }], sshKeys: [key, prior], playbooks: [
      pb, { ...pb, id: id("foreign-r"), steps: [notify(userB)] },
      { ...pb, id: id("foreign-s"), steps: [{ id: "run", name: "Check", type: "run_command", config: { serverIds: [serverB], command: "true" } }] },
    ] }), { importUsers: false });
    expect(preview.summary[tableKey("playbooks")]).toEqual({ create: 1, update: 0, skip: 2 });
    expect((await prisma.playbook.findUniqueOrThrow({ where: { id: pb.id } })).steps).toMatchObject([{ config: { recipientUserId: userA } }]);
    expect(await prisma.sshKey.count({ where: { id: { in: [key.id, prior.id] }, createdById: userA } })).toBe(2);
  });

  it("resets metric state on metric changes and disables undeliverable imported rules", async () => {
    const row = { id: id("metric-change"), name: "CPU", teamId: a, metric: "mem_usage", operator: "gt", threshold: 80,
      durationSeconds: 120, cooldownMinutes: 5, serverIds: [], notifyChannels: ["webhook"], webhookUrl: null,
      playbookIds: [], onCallUserIds: [], escalationMinutes: null, silenceWindows: [], enabled: true, createdAt: stamp };
    await prisma.alertRule.create({ data: { id: row.id, teamId: a, name: row.name, metric: "cpu_usage", operator: "gt",
      threshold: 80, lastMatchedAt: new Date(), matchState: { fixture: stamp }, webhookUrl: "https://example.test/delivery" } });
    const fresh = id("missing-hook");
    const restricted = id("awaiting-channels");
    const preview = await comparePreviewAndImport({ ...bundle({ alertRules: [row, { ...row, id: fresh },
      { ...row, id: restricted, notifyChannels: ["email", "telegram"] }] }), exportMode: "standard" });
    expect(preview.issues).toContainEqual({ table: "alertRules", id: restricted, reason: "common.status.pendingApproval" });
    expect(await prisma.alertRule.findUniqueOrThrow({ where: { id: restricted } })).toMatchObject({ enabled: false, notifyChannels: ["email", "telegram"] });
    expect(preview.issues).toContainEqual(expect.objectContaining({ table: "alertRules", id: fresh }));
    expect(await prisma.alertRule.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ matchState: {}, lastMatchedAt: null, enabled: true, webhookUrl: "https://example.test/delivery" });
    expect(await prisma.alertRule.findUniqueOrThrow({ where: { id: fresh } })).toMatchObject({ enabled: false, webhookUrl: null });
  });

  it("keeps the local built-in command catalog and counts protected templates and unwritable settings as skips", async () => {
    const builtin = { id: id("builtin"), name: id("catalog-name"), command: "true", isBuiltin: true, createdById: null,
      teamId: null, description: null, rollbackCommand: null, variables: [], tags: [], createdAt: stamp };
    await prisma.commandTemplate.create({ data: { id: builtin.id, name: builtin.name, command: builtin.command, isBuiltin: true } });
    const identity = { id: "identity:viewer", name: "Viewer", isBuiltin: true, permissions: [], description: null };
    await prisma.identityTemplate.upsert({ where: { id: identity.id }, create: identity, update: {} });
    const preview = await comparePreviewAndImport(bundle({
      commandTemplates: [{ ...builtin, id: id("source-builtin") }, { ...builtin, teamId: a, id: id("tenant-builtin") },
        { ...builtin, isBuiltin: false, command: "changed" }, { ...builtin, teamId: a, id: id("custom"), isBuiltin: false }],
      identityTemplates: [{ ...identity, name: "unwritable" }],
      settings: [{ key: "smtp.pass", value: "" }, { key: id("internal"), value: "ignored" }],
    }), { importSettings: true });
    expect(preview.summary[tableKey("commandTemplates")]).toEqual({ create: 1, update: 0, skip: 3 });
    expect(preview.summary[tableKey("identityTemplates")]).toMatchObject({ skip: 1 });
    expect(preview.summary[tableKey("settings")]).toMatchObject({ skip: 2 });
    expect(await prisma.commandTemplate.count({ where: { name: builtin.name, isBuiltin: true } })).toBe(1);
    expect((await prisma.commandTemplate.findUniqueOrThrow({ where: { id: builtin.id } })).command).toBe("true");
  });

  it("reserves storage bindings and provider names within the package and demotes only the owner's previous default", async () => {
    const provider = (key: string, name = key, owner = userA) => ({
      id: id(key), name, createdBy: owner, type: "OPENAI", baseUrl: "https://api.example.test", apiKey: null,
      availableModels: "[]", defaultModel: "test", settings: {}, isDefault: true, enabled: false, createdAt: stamp,
    });
    const previous = id("old-default");
    await prisma.aiProvider.createMany({ data: [userA, userB].map((owner) => ({
      id: owner === userA ? previous : id("other-default"), name: "Old", createdBy: owner, apiKey: "", isDefault: true,
    })) });
    const bound = serverA;
    const preview = await comparePreviewAndImport(bundle({ storageNodes: [
      storageRow(id("bound"), a, bound), storageRow(id("collision"), a, bound), storageRow(nodeA, a, bound),
    ], aiProviders: [provider("name-conflict", "Old"), provider("first-default"), provider("last-default"),
      provider("duplicate", "last-default"), provider("absent-owner", "Free", id("missing-user"))] }));
    expect(preview.summary[tableKey("storageNodes")]).toEqual({ create: 1, update: 0, skip: 2 });
    expect(preview.summary[tableKey("aiProviders")]).toEqual({ create: 2, update: 0, skip: 3 });
    expect(preview.issues?.some((issue) => issue.table === "aiProviders" && issue.id.includes(previous))).toBe(true);
    expect(await prisma.aiProvider.findMany({ where: { createdBy: userA, isDefault: true }, select: { id: true } })).toEqual([{ id: id("last-default") }]);
    expect(await prisma.aiProvider.count({ where: { createdBy: userB, isDefault: true } })).toBe(1);
  });

  it.each(["before", "after"])("sees a default written %s the import reaches the normal editor's lock", async (order) => {
    const owner = id("racing-owner-" + order);
    await prisma.user.create({ data: { id: owner, username: owner, passwordHash: "fixture" } });
    const row = { id: id("import-default-" + order), name: "Imported", createdBy: owner, type: "OPENAI", apiKey: null,
      availableModels: "[]", defaultModel: "test", baseUrl: "https://api.example.test", settings: {},
      isDefault: true, enabled: false, createdAt: stamp };
    let imported: ReturnType<typeof executeImport> | undefined;
    await prisma.$transaction(async (tx) => {
      await lockForTransaction(tx, "ai-provider-default", owner);
      const create = () => tx.aiProvider.create({ data: { name: "Concurrent", apiKey: "", isDefault: true, createdBy: owner } });
      if (order === "before") await create();
      imported = executeImport(bundle({ aiProviders: [row] }), options);
      // Release the writer only once the import is waiting. No timing guess
      // about which transaction gets the older snapshot.
      await vi.waitFor(async () => {
        const [waiting] = await tx.$queryRaw<{ present: boolean }[]>`
          SELECT EXISTS (SELECT FROM pg_locks WHERE NOT granted AND pg_backend_pid() = ANY(pg_blocking_pids(pid))) AS present
        `;
        expect(waiting?.present).toBe(true);
      }, { timeout: 4000 });
      if (order === "after") await create();
    }, { timeout: 10_000 });
    expect(await imported).toMatchObject({ created: 1, errors: [] });
    expect(await prisma.aiProvider.findMany({ where: { createdBy: owner, isDefault: true }, select: { id: true } })).toEqual([{ id: row.id }]);
  });

  it("projects duplicate parents before role assignments and conserves every input row", async () => {
    const role = { id: id("accepted-role"), key: id("role-key"), name: "Role", description: null };
    const missing = id("skipped-role");
    const user = userRow(id("accepted-user"), id("username"));
    const join = { userId: user.id, roleId: role.id, assignedAt: stamp };
    const preview = await comparePreviewAndImport(bundle({
      roles: [role, { ...role, id: missing }], users: [user, { ...user, id: id("skipped-user") }],
      userRoles: [join, join, { ...join, roleId: missing }, { ...join, userId: id("skipped-user") }],
    }));
    expect(preview.summary[tableKey("userRoles")]).toEqual({ create: 1, update: 0, skip: 3 });
    expect(preview.summary[tableKey("roles")]).toEqual({ create: 1, update: 0, skip: 1 });
  });

  it("rejects cross-customer automation and grant collisions and protects a sole default node", async () => {
    const command = { id: id("owner-command"), name: id("owner-command"), description: null, command: "true",
      rollbackCommand: null, variables: [], tags: [], isBuiltin: false, createdById: null, teamId: a, createdAt: stamp };
    const playbook = { id: pbA, name: pbA, description: null, triggerType: "cron", triggerConfig: { expression: "0 0 * * *" }, chainRetry: 0,
      steps: [{ id: "note", type: "send_notification", name: "Note", config: { recipientUserId: userB, subject: "note", body: "note" } }],
      enabled: true, createdById: null, teamId: b, createdAt: stamp };
    await prisma.commandTemplate.create({ data: { id: command.id, name: command.name, command: "true", teamId: b } });
    const grant = { id: id("owner-grant"), userId: userA, storageNodeId: nodeA, pathPrefix: "", canRead: true,
      canWrite: false, canDelete: false, quotaBytes: null, maxFileBytes: null, createdAt: stamp };
    await prisma.userStorageAccess.create({ data: { id: grant.id, userId: userB, storageNodeId: nodeB, pathPrefix: "/owner" } });
    await prisma.storageNode.update({ where: { id: nodeA }, data: { isDefault: true } });
    try {
      const files = [bundle({ commandTemplates: [command] }), bundle({ playbooks: [playbook] }), bundle({ userStorageAccess: [grant] }),
        bundle({ storageNodes: [{ ...storageRow(nodeA, a, null), isDefault: false }] })];
      for (const file of files) {
        expect(await previewImport(file, options)).toMatchObject({ totalRecords: 0, issues: [expect.objectContaining({ blocking: true })] });
        expect(await executeImport(file, options)).toMatchObject({ created: 0, updated: 0, rolledBack: true });
      }
      expect(await prisma.storageNode.findUniqueOrThrow({ where: { id: nodeA } })).toMatchObject({ isDefault: true, teamId: a });
      expect(await prisma.userStorageAccess.findUniqueOrThrow({ where: { id: grant.id } })).toMatchObject({ userId: userB, storageNodeId: nodeB });
    } finally {
      await prisma.storageNode.update({ where: { id: nodeA }, data: { isDefault: false } });
    }
  });

  it("previews each atomic overwrite guard and rolls back independent writes", async () => {
    const key = sshRow(id("guarded-key"), userA);
    await prisma.sshKey.create({ data: { id: key.id, name: key.name, publicKey: "target", fingerprint: key.id, teamId: a } });
    const file = bundle({ servers: [serverRow(serverA, b, null)], sshKeys: [key], storageNodes: [storageRow(nodeB, a, null)] });
    const preview = await previewImport(file, options);
    for (const row of [serverA, nodeB, key.id]) expect(preview.issues).toContainEqual(expect.objectContaining({ id: row, blocking: true }));
    for (const table of ["servers", "storageNodes", "sshKeys"] as const) {
      const role = { id: id("rollback-role"), key: id("rollback-role"), name: "Rollback", description: null };
      expect(await executeImport(bundle({ roles: [role], [table]: file.tables[table] }), options)).toMatchObject({ rolledBack: true, created: 0, updated: 0 });
      expect(await prisma.role.count({ where: { id: role.id } })).toBe(0);
    }
  });

  it("preserves verified private snippet ownership and skips an unmapped author on creation", async () => {
    const row = { id: id("private"), title: "Private", language: "text", content: "fixture", description: null,
      tags: [], isPrivate: true, createdBy: id("absent-author"), createdAt: stamp };
    await prisma.snippet.create({ data: { id: row.id, title: row.title, content: "old", createdBy: userA, isPrivate: true } });
    const preview = await comparePreviewAndImport(bundle({ snippets: [row, { ...row, id: id("orphan") }] }), { importUsers: false });
    expect(preview.summary[tableKey("snippets")]).toEqual({ create: 0, update: 1, skip: 1 });
    expect(await prisma.snippet.findUniqueOrThrow({ where: { id: row.id } })).toMatchObject({ createdBy: userA, content: "fixture" });
  });

  it("clears only explicit full-export passwords, environment and mounts", async () => {
    const sid = id("credentials");
    const server = { ...serverRow(sid, a, null), connectionType: "PASSWORD" };
    await prisma.server.create({ data: { ...serverData(sid, a), connectionType: "PASSWORD", password: "ssh", rdpPassword: "rdp" } });
    const quick = { id: id("env"), slug: id("env"), name: "Env", category: "other", icon: "app", description: "",
      image: "example/app", port: 15000, path: "/", internalPort: null, extraPortsJson: "[]", command: null, status: "stopped", createdAt: stamp };
    await prisma.quickService.create({ data: { slug: quick.slug, id: quick.id, name: quick.name, image: quick.image, port: quick.port, envJson: '{"key":"fixture"}', volumesJson: '["fixture"]' } });
    for (const mode of ["standard", "legacy", "full"] as const) {
      const explicit = mode !== "legacy";
      const file = bundle({ servers: [{ ...server, password: explicit ? null : undefined, rdpPassword: explicit ? null : undefined }],
        quickServices: [{ ...quick, envJson: explicit ? "{}" : undefined, volumesJson: explicit ? "[]" : undefined }] });
      await comparePreviewAndImport({ ...file, exportMode: mode === "legacy" ? "full" : mode });
      expect(await prisma.server.findUniqueOrThrow({ where: { id: sid } })).toMatchObject({
        password: mode === "full" ? null : "ssh", rdpPassword: mode === "full" ? null : "rdp",
      });
      expect(await prisma.quickService.findUniqueOrThrow({ where: { id: quick.id } })).toMatchObject({
        envJson: mode === "full" ? "{}" : '{"key":"fixture"}', volumesJson: mode === "full" ? "[]" : '["fixture"]',
      });
    }
  });
});
