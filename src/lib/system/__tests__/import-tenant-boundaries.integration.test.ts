// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "@/lib/db";
import { EXPORT_SCHEMA_VERSION, exportFileSchema, type ExportFile } from "../config-schema";
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
    await prisma.identityTemplate.deleteMany({ where: { id: template } });
    await prisma.team.deleteMany({ where: { id: { in: [a, b] } } });
    await prisma.$disconnect();
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
});
