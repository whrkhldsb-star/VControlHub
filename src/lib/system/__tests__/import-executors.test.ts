/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";

/**
 * `executeImport` writes the global RBAC catalog and infrastructure tables from
 * an uploaded file in one transaction. Two things are load-bearing:
 *
 *   - the fixed dependency order (a RolePermission cannot precede its Role, a
 *     UserStorageAccess cannot precede its StorageNode)
 *   - the reported counts must describe what is actually in the database. On
 *     rollback everything is gone, so surfacing the in-transaction totals would
 *     tell the operator "created 240 rows" over an unchanged database.
 */

const ORDER: string[] = [];

const mocks = vi.hoisted(() => ({ transaction: vi.fn() }));

vi.mock("@/lib/db", () => ({ prisma: { $transaction: mocks.transaction } }));

function recorder(name: string) {
  return vi.fn(async (_tx: unknown, _t: unknown, _o: unknown, counts: { created: number }) => {
    ORDER.push(name);
    counts.created += 1;
  });
}

const executors = {
  importPermissions: recorder("permissions"),
  importRoles: recorder("roles"),
  importRolePermissions: recorder("rolePermissions"),
  importUsers: recorder("users"),
  importUserRoles: recorder("userRoles"),
  importSshKeys: recorder("sshKeys"),
  importServers: recorder("servers"),
  importStorageNodes: recorder("storageNodes"),
  importUserStorageAccess: recorder("userStorageAccess"),
  importCommandTemplates: recorder("commandTemplates"),
  importQuickServices: recorder("quickServices"),
  importPlaybooks: recorder("playbooks"),
  importAlertRules: recorder("alertRules"),
  importSettings: recorder("settings"),
  importAiProviders: recorder("aiProviders"),
  importAnnouncements: recorder("announcements"),
  importSnippets: recorder("snippets"),
};

vi.mock("../import-executors-rbac", () => ({
  importPermissions: executors.importPermissions,
  importRoles: executors.importRoles,
  importRolePermissions: executors.importRolePermissions,
  importUsers: executors.importUsers,
  importUserRoles: executors.importUserRoles,
}));
vi.mock("../import-executors-infrastructure", () => ({
  importSshKeys: executors.importSshKeys,
  importServers: executors.importServers,
  importStorageNodes: executors.importStorageNodes,
  importUserStorageAccess: executors.importUserStorageAccess,
}));
vi.mock("../import-executors-automation", () => ({
  importCommandTemplates: executors.importCommandTemplates,
  importQuickServices: executors.importQuickServices,
  importPlaybooks: executors.importPlaybooks,
  importAlertRules: executors.importAlertRules,
}));
vi.mock("../import-executors-config", () => ({
  importSettings: executors.importSettings,
  importAiProviders: executors.importAiProviders,
  importAnnouncements: executors.importAnnouncements,
  importSnippets: executors.importSnippets,
}));
vi.mock("../import-executors-helpers", () => ({}));

const { executeImport } = await import("../import-executors");

const FILE = { tables: {} } as unknown as ExportFile;
const OPTIONS = {
  dryRun: false,
  overwriteExisting: true,
  importUsers: true,
  importSettings: true,
} satisfies ImportOptions;

describe("executeImport", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ORDER.length = 0;
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => fn({}));
  });

  it("runs every table exactly once, in dependency order", async () => {
    await executeImport(FILE, OPTIONS);

    expect(ORDER).toEqual([
      "permissions",
      "roles",
      "rolePermissions",
      "users",
      "userRoles",
      "sshKeys",
      "servers",
      "storageNodes",
      "userStorageAccess",
      "commandTemplates",
      "quickServices",
      "playbooks",
      "alertRules",
      "settings",
      "aiProviders",
      "announcements",
      "snippets",
    ]);
  });

  it("reports the accumulated counts and no rollback flag on success", async () => {
    const result = await executeImport(FILE, OPTIONS);

    expect(result).toEqual({ created: 17, updated: 0, skipped: 0, errors: [] });
    expect(result).not.toHaveProperty("rolledBack");
  });

  it("gives the transaction a window wide enough for a large multi-table import", async () => {
    await executeImport(FILE, OPTIONS);

    // Prisma's 5s interactive default surfaces as P2028 halfway through a real
    // bundle, which then rolls back everything.
    expect(mocks.transaction).toHaveBeenCalledWith(expect.any(Function), {
      timeout: 120_000,
      maxWait: 20_000,
    });
  });

  it("zeroes created/updated when the transaction rolls back", async () => {
    mocks.transaction.mockRejectedValue(new Error("P2028 transaction closed"));

    const result = await executeImport(FILE, OPTIONS);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(0);
    expect(result.rolledBack).toBe(true);
    expect(result.errors).toEqual(["Transaction failed: P2028 transaction closed"]);
    // `skipped` survives on purpose: a skipped record was never written, so its
    // count is still true of the database after a rollback.
    expect(result.skipped).toBe(0);
  });

  it("surfaces a non-Error rejection as text rather than [object Object]", async () => {
    mocks.transaction.mockRejectedValue("db gone");

    const result = await executeImport(FILE, OPTIONS);

    expect(result.errors[0]).toBe("Transaction failed: db gone");
  });

  it("does not resolve successfully with a half-applied count when one table throws", async () => {
    // The executors run inside the callback, so a mid-way throw must propagate to
    // $transaction and come back as a rollback — not as "created: 3".
    executors.importUsers.mockRejectedValueOnce(new Error("bad row"));
    mocks.transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn({});
    });

    const result = await executeImport(FILE, OPTIONS);

    expect(result.rolledBack).toBe(true);
    expect(result.created).toBe(0);
    expect(result.errors[0]).toContain("bad row");
    // Later tables must not have run.
    expect(ORDER).not.toContain("snippets");
  });
});
