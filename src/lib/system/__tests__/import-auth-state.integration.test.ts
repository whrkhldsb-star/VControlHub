// @vitest-environment node
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
import { exportFileSchema } from "../config-schema";
import { executeImport } from "../import-executors";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("imported authentication state", () => {
  const id = `auth-import-fix-${randomUUID()}`;
  const options = { dryRun: false, importUsers: true, overwriteExisting: true, importSettings: false };
  beforeAll(async () => {
    const db = new URL(process.env.DATABASE_URL!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("Disposable database required");
    await prisma.user.create({ data: { id, username: id, passwordHash: "unchanged-hash", status: "ACTIVE", mustChangePassword: false, twoFactorEnabled: true, twoFactorSecret: "old-seed" } });
  });
  afterAll(async () => { await prisma.user.deleteMany({ where: { id } }); await prisma.$disconnect(); });
  const file = (enabled: boolean, secret: string | null, mode = "full") => exportFileSchema.parse({ schemaVersion: 1, exportedAt: new Date().toISOString(), sourceDomain: "audit.invalid", exportMode: mode, tables: {
    ...Object.fromEntries(["permissions", "roles", "rolePermissions", "userRoles", "sshKeys", "servers", "storageNodes", "userStorageAccess", "commandTemplates", "quickServices", "playbooks", "alertRules", "settings", "aiProviders", "announcements", "snippets"].map((key) => [key, []])),
    users: [{ id, username: id, displayName: null, passwordHash: "unchanged-hash", status: "ACTIVE", mustChangePassword: false, twoFactorEnabled: enabled, twoFactorSecret: secret, twoFactorRecoveryCodes: null, preferences: null, createdAt: new Date().toISOString() }],
  } });
  it("revokes an old session when the imported second factor changes", async () => {
    const cookie = await createSessionToken({ userId: id, username: id, roles: [], mustChangePassword: false, currentTeamId: null });
    expect((await executeImport(file(true, "new-seed"), options)).errors).toEqual([]);
    await expect(verifySessionToken(cookie)).rejects.toThrow();
  });
  it("restores an explicitly disabled factor in a full package", async () => {
    expect((await executeImport(file(false, null), options)).errors).toEqual([]);
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ twoFactorEnabled: false, twoFactorSecret: null, twoFactorRecoveryCodes: null });
  });
  it("preserves the target factor when the standard package strips its secret", async () => {
    await prisma.user.update({ where: { id }, data: { twoFactorEnabled: true, twoFactorSecret: "keep-seed" } });
    expect((await executeImport(file(false, null, "standard"), options)).errors).toEqual([]);
    expect(await prisma.user.findUniqueOrThrow({ where: { id } })).toMatchObject({ twoFactorEnabled: true, twoFactorSecret: "keep-seed" });
  });
});
