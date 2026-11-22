// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";

import { ConflictError, ValidationError } from "@/lib/errors";
import { tenantStorageBasePath } from "@/lib/storage/path-utils";
import type { ExportFile } from "../config-schema";
import { alignImportIds } from "../import-id-alignment";
import { assertImportHasActiveAdmin, importRoles, importUsers, importUserRoles } from "../import-executors-rbac";
import { importTeamMembers } from "../import-executors-tenancy";
import type { Tx } from "../import-executors-helpers";

type Tables = ExportFile["tables"];
const stamp = "2026-01-01T00:00:00.000Z";
const options = { dryRun: false, overwriteExisting: true, importUsers: true, importSettings: false };
const counts = () => ({ created: 0, updated: 0, skipped: 0 });
const tables = (rows: Partial<Tables>): Tables => ({
  teams: [], identityTemplates: [], teamMembers: [], userServerAccess: [], permissions: [], roles: [],
  rolePermissions: [], users: [], userRoles: [], sshKeys: [], servers: [], storageNodes: [], userStorageAccess: [],
  commandTemplates: [], quickServices: [], playbooks: [], alertRules: [], settings: [], aiProviders: [], announcements: [], snippets: [],
  ...rows,
});
const user = { id: "source", username: "operator", displayName: null, status: "ACTIVE", passwordHash: null,
  mustChangePassword: false, twoFactorEnabled: false, twoFactorSecret: null, preferences: null, createdAt: stamp };
const member = { userId: user.id, teamId: "customer", identityTemplateId: "template", joinedAt: stamp };
const adminRole = { id: "admin-role", name: "Admin", key: "admin", description: null };
const assignment = { userId: user.id, roleId: adminRole.id, assignedAt: stamp };

describe("imported account types", () => {
  it.each(["admin", "customer"] as const)("rejects matching the username of an existing %s to the other account type", async (target) => {
    const db = {
      user: { findMany: vi.fn().mockResolvedValueOnce([{ id: "target", username: user.username }]).mockResolvedValueOnce([])
        .mockResolvedValueOnce([{ id: "target", roles: target === "admin" ? [{ role: adminRole }] : [],
          teamMembership: target === "customer" ? { teamId: "another" } : null }]) },
      role: { findMany: vi.fn().mockResolvedValue([]), findUnique: vi.fn().mockResolvedValue(null) },
    } as unknown as Tx;
    const incoming = target === "admin" ? { teamMembers: [member] } : { roles: [adminRole], userRoles: [assignment] };
    await expect(alignImportIds(db, tables({ users: [user], ...incoming }))).rejects.toThrow(ValidationError);
  });

  it("refuses renaming an assigned customer role to admin in a role-only import", async () => {
    const tx = { user: { findFirst: vi.fn().mockResolvedValue({ id: user.id }) },
      role: { findMany: vi.fn().mockResolvedValue([{ id: adminRole.id }]), findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    await expect(importRoles(tx as unknown as Tx, tables({ roles: [adminRole] }), options, counts())).rejects.toThrow(ValidationError);
    expect(tx.user.findFirst).toHaveBeenCalledWith({ where: { roles: { some: { roleId: adminRole.id } }, teamMembership: { isNot: null } }, select: { id: true } });
    expect(tx.role.update).not.toHaveBeenCalled();
  });

  it("rejects assigning the locally resolved admin role to a current customer", async () => {
    const tx = {
      userRole: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn() },
      role: { findMany: vi.fn().mockResolvedValue([adminRole]) },
      user: { findMany: vi.fn().mockResolvedValue([{ id: user.id, teamMembership: { teamId: "existing" } }]) },
    };
    await expect(importUserRoles(tx as unknown as Tx, tables({ userRoles: [assignment] }), options, counts())).rejects.toThrow(ValidationError);
    expect(tx.userRole.createMany).not.toHaveBeenCalled();
  });

  it("refuses overwriting the membership of a user who still holds admin", async () => {
    const tx = {
      user: { findMany: vi.fn().mockResolvedValue([{ id: user.id, teamMembership: { teamId: "customer" }, roles: [{ role: adminRole }] }]) },
      team: { findMany: vi.fn().mockResolvedValue([{ id: "customer" }]) },
      identityTemplate: { findMany: vi.fn().mockResolvedValue([{ id: "template" }]) },
      teamMember: { findMany: vi.fn().mockResolvedValue([member]), update: vi.fn() },
    };
    await expect(importTeamMembers(tx as unknown as Tx, tables({ teamMembers: [member] }), options, counts())).rejects.toThrow(ValidationError);
    expect(tx.teamMember.update).not.toHaveBeenCalled();
  });

  it("requires an ACTIVE administrator outside all customers at commit", async () => {
    const query = vi.fn().mockResolvedValueOnce([]).mockResolvedValueOnce([{ id: "admin" }]);
    const tx = { $queryRaw: query } as unknown as Tx;
    await expect(assertImportHasActiveAdmin(tx)).rejects.toThrow(ConflictError);
    const sql = (query.mock.calls[0]![0] as TemplateStringsArray).join("?");
    expect(sql).toContain("u.status = 'ACTIVE' AND r.key = 'admin'");
    expect(sql).toContain('NOT EXISTS (SELECT 1 FROM team_members m WHERE m."userId" = u.id)');
    expect(sql).toContain("FOR SHARE");
    await expect(assertImportHasActiveAdmin(tx)).resolves.toBeUndefined();
  });
});

describe("redacted account imports", () => {
  it("keeps new disabled users disabled and requires password reset for new active users", async () => {
    const db = { user: { findMany: vi.fn().mockResolvedValue([]), createMany: vi.fn().mockResolvedValue({ count: 2 }) } };
    const users = [user, { ...user, id: "disabled", username: "disabled", status: "DISABLED" }];
    await importUsers(db as unknown as Tx, tables({ users }), options, counts(), "standard");
    expect(db.user.createMany.mock.calls[0]![0].data).toMatchObject([
      { status: "PENDING_PASSWORD_RESET", mustChangePassword: true }, { status: "DISABLED", mustChangePassword: true },
    ]);
  });

  it("keeps an existing import-placeholder administrator pending on a second standard restore", async () => {
    const db = { user: { findMany: vi.fn().mockResolvedValue([{ id: user.id, status: "PENDING_PASSWORD_RESET", mustChangePassword: true, passwordHash: "DISABLED_IMPORT_RESET" }]),
      findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    await importUsers(db as unknown as Tx, tables({ users: [user] }), options, counts(), "standard");
    expect(db.user.update.mock.calls[0]![0].data).toMatchObject({ status: "PENDING_PASSWORD_RESET", mustChangePassword: true });
  });

  it.each([
    ["ACTIVE", false, "DISABLED", false, true],
    ["ACTIVE", false, "ACTIVE", true, true],
    ["ACTIVE", false, "ACTIVE", false, false],
    ["ACTIVE", true, "ACTIVE", true, false],
  ] as const)("changes %s/reset=%s to %s/reset=%s and advances the epoch=%s", async (was, oldReset, status, mustChangePassword, revoke) => {
    const db = { user: { findMany: vi.fn().mockResolvedValue([{ id: user.id, status: was, mustChangePassword: oldReset }]),
      findFirst: vi.fn().mockResolvedValue(null), update: vi.fn() } };
    await importUsers(db as unknown as Tx, tables({ users: [{ ...user, status, mustChangePassword }] }), options, counts(), "standard");
    const update = db.user.update.mock.calls[0]![0].data;
    expect(update).toMatchObject({ status, mustChangePassword });
    if (revoke) expect(update.sessionEpoch).toEqual({ increment: 1 });
    else expect(update).not.toHaveProperty("sessionEpoch");
  });
});

describe("customer resource alignment", () => {
  const identity = { id: "narrow", name: "Support", permissions: ["server:read"], isBuiltin: false, description: null };
  it.each([
    [["narrow", "broad"], ["target"], ["narrow", "broad"]],
    [["narrow"], ["one", "two"], ["narrow"]],
    [["narrow"], ["target"], ["target"]],
  ])("aligns only 1:1 template names (source %j, target %j)", async (sourceIds, targetIds, expected) => {
    const rows = sourceIds.map((id) => ({ ...identity, id, permissions: [id === "broad" ? "server:manage" : "server:read"] }));
    const db = { identityTemplate: { findMany: vi.fn().mockResolvedValueOnce(targetIds.map((id) => ({ ...identity, id }))).mockResolvedValueOnce([]) },
      user: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as Tx;
    const result = await alignImportIds(db, tables({ identityTemplates: rows, teamMembers: rows.map((row) => ({ ...member, userId: row.id, identityTemplateId: row.id })) }));
    expect(result.identityTemplates.map((row) => row.id)).toEqual(expected);
    expect(result.teamMembers.map((row) => row.identityTemplateId)).toEqual(expected);
  });

  it("never binds a custom template to a builtin or to a differently privileged namesake", async () => {
    for (const target of [{ ...identity, id: "identity:customer_admin", isBuiltin: true }, { ...identity, id: "broad", permissions: ["server:connect"] }]) {
      const db = { identityTemplate: { findMany: vi.fn().mockResolvedValueOnce([target]).mockResolvedValueOnce([]) } } as unknown as Tx;
      const aligned = await alignImportIds(db, tables({ identityTemplates: [identity] }));
      expect(aligned.identityTemplates[0]?.id).toBe(identity.id);
    }
    const db = { identityTemplate: { findMany: vi.fn().mockResolvedValue([]) } } as unknown as Tx;
    await expect(alignImportIds(db, tables({ identityTemplates: [{ ...identity, isBuiltin: true }] }))).rejects.toThrow("IMPORT_TEMPLATE_KIND");
  });

  const team = { id: "source-team", slug: "acme", name: "Acme", description: null };
  afterEach(() => vi.unstubAllEnvs());
  const storage = { id: "node", name: "Local", driver: "LOCAL", isDefault: true, teamId: team.id,
    basePath: "storage/teams/source-team/photos", directAccessMode: "PROXY", publicBaseUrl: null, directAccessExpiresSeconds: 0,
    host: null, port: null, username: null, serverId: null, healthStatus: "UNKNOWN" as const, createdAt: stamp };
  function alignNode(basePath: string, driver = "LOCAL") {
    const db = { team: { findMany: vi.fn().mockResolvedValueOnce([{ id: "target-team", slug: team.slug }]).mockResolvedValueOnce([]) } } as unknown as Tx;
    return alignImportIds(db, tables({ teams: [team], storageNodes: [{ ...storage, basePath, driver }] }));
  }
  it("rewrites standard LOCAL roots and descendants, preserving remote paths", async () => {
    const root = tenantStorageBasePath("target-team");
    expect((await alignNode(storage.basePath)).storageNodes[0]).toMatchObject({ teamId: "target-team", basePath: `${root}/photos` });
    expect((await alignNode("/var/lib/vcontrolhub/storage/teams/source-team")).storageNodes[0]?.basePath).toBe(root);
    expect((await alignNode("/srv/custom", "SFTP")).storageNodes[0]?.basePath).toBe("/srv/custom");
  });
  it("recognises the complete configured root even when an earlier directory is named teams", async () => {
    vi.stubEnv("STORAGE_ROOT", "C:/teams/shared-storage");
    expect((await alignNode("C:\\teams\\shared-storage\\teams\\source-team\\notes")).storageNodes[0]?.basePath)
      .toBe("C:/teams/shared-storage/teams/target-team/notes");
  });
  it.each(["/custom/unrecognised/teams/source-team", "/srv/shared", "/storage/teams/source-team-extra", "storage/teams/source-team/../another", "/teams/another/teams/source-team"])(
    "rejects unsafe or nonstandard local root %s before import", async (basePath) => {
      await expect(alignNode(basePath)).rejects.toThrow(/node/);
    });
});
