/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import type { Counts, Tx } from "../import-executors-helpers";
import { importPermissions } from "../import-executors-rbac";
import { importServers, importStorageNodes, importUserStorageAccess } from "../import-executors-infrastructure";
import { importAlertRules } from "../import-executors-automation";

/**
 * Per-table import behaviour that the orchestration test cannot see: which rows
 * are skipped rather than written. "Skip" is the only safe answer when an
 * uploaded row would collide with a live one or point at a row that does not
 * exist — the alternative is a unique/FK violation that rolls back the whole
 * bundle.
 */

function counts(): Counts {
  return { created: 0, updated: 0, skipped: 0 };
}

const OVERWRITE = {
  dryRun: false,
  overwriteExisting: true,
  importUsers: true,
  importSettings: true,
} satisfies ImportOptions;
const NO_OVERWRITE = { ...OVERWRITE, overwriteExisting: false } satisfies ImportOptions;

function tables(partial: Record<string, unknown>): ExportFile["tables"] {
  return partial as unknown as ExportFile["tables"];
}

// ── importPermissions ───────────────────────────────────

type PermRow = { id: string; key: string; name: string; description: string | null };

function perm(id: string, key: string): PermRow {
  return { id, key, name: key, description: null };
}

function permTx(opts: {
  existingIds?: string[];
  keysTaken?: { id: string; key: string }[];
  updateClash?: boolean;
  createCount?: number;
}) {
  const findMany = vi.fn();
  // 1st call: which ids already exist. 2nd call: which secondary keys are taken.
  findMany.mockResolvedValueOnce((opts.existingIds ?? []).map((id) => ({ id })));
  findMany.mockResolvedValueOnce(opts.keysTaken ?? []);
  const createMany = vi.fn().mockResolvedValue({ count: opts.createCount ?? 0 });
  const findFirst = vi.fn().mockResolvedValue(opts.updateClash ? { id: "other" } : null);
  const update = vi.fn().mockResolvedValue({});
  const tx = { permission: { findMany, createMany, findFirst, update } } as unknown as Tx;
  return { tx, findMany, createMany, findFirst, update };
}

describe("importPermissions", () => {
  it("touches the database not at all for an empty table", async () => {
    const { tx, findMany } = permTx({});
    const c = counts();

    await importPermissions(tx, tables({ permissions: [] }), OVERWRITE, c);

    expect(findMany).not.toHaveBeenCalled();
    expect(c).toEqual({ created: 0, updated: 0, skipped: 0 });
  });

  it("skips a new row whose key is already taken by a different id", async () => {
    // The bundle's `p-new` carries key "server:read", which a live row already
    // owns. Inserting it would violate the unique index and roll back everything.
    const { tx, createMany } = permTx({
      keysTaken: [{ id: "p-live", key: "server:read" }],
    });
    const c = counts();

    await importPermissions(
      tx,
      tables({ permissions: [perm("p-new", "server:read"), perm("p-ok", "server:write")] }),
      OVERWRITE,
      c,
    );

    expect(c.skipped).toBe(1);
    expect(createMany).toHaveBeenCalledTimes(1);
    const data = createMany.mock.calls[0]?.[0]?.data as PermRow[];
    expect(data.map((r) => r.id)).toEqual(["p-ok"]);
  });

  it("counts only the rows createMany actually inserted", async () => {
    const { tx, createMany } = permTx({ createCount: 2 });
    const c = counts();

    await importPermissions(
      tx,
      tables({ permissions: [perm("a", "k:a"), perm("b", "k:b"), perm("c", "k:c")] }),
      OVERWRITE,
      c,
    );

    expect(createMany.mock.calls[0]?.[0]?.skipDuplicates).toBe(true);
    expect(c.created).toBe(2);
  });

  it("skips existing rows instead of overwriting them when overwriteExisting is off", async () => {
    const { tx, update } = permTx({ existingIds: ["a"] });
    const c = counts();

    await importPermissions(tx, tables({ permissions: [perm("a", "k:a")] }), NO_OVERWRITE, c);

    expect(update).not.toHaveBeenCalled();
    expect(c).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it("skips an update whose new key would collide with another live row", async () => {
    const { tx, update, findFirst } = permTx({ existingIds: ["a"], updateClash: true });
    const c = counts();

    await importPermissions(tx, tables({ permissions: [perm("a", "k:taken")] }), OVERWRITE, c);

    expect(findFirst).toHaveBeenCalledWith({
      where: { key: "k:taken", NOT: { id: "a" } },
      select: { id: true },
    });
    expect(update).not.toHaveBeenCalled();
    expect(c).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it("updates an existing row when its key is free", async () => {
    const { tx, update } = permTx({ existingIds: ["a"] });
    const c = counts();

    await importPermissions(tx, tables({ permissions: [perm("a", "k:a")] }), OVERWRITE, c);

    expect(update).toHaveBeenCalledWith({
      where: { id: "a" },
      data: { key: "k:a", name: "k:a", description: null },
    });
    expect(c).toEqual({ created: 0, updated: 1, skipped: 0 });
  });
});

// ── importUserStorageAccess ─────────────────────────────

type AccessRow = {
  id: string;
  userId: string;
  storageNodeId: string;
  pathPrefix: string;
  canRead: boolean;
  canWrite: boolean;
  canDelete: boolean;
  quotaBytes: string | null;
  maxFileBytes: string | null;
};

function access(over: Partial<AccessRow> = {}): AccessRow {
  return {
    id: "acc-1",
    userId: "u1",
    storageNodeId: "n1",
    pathPrefix: "/",
    canRead: true,
    canWrite: true,
    canDelete: false,
    quotaBytes: null,
    maxFileBytes: null,
    ...over,
  };
}

function accessTx(opts: {
  existingIds?: string[];
  userIds?: string[];
  nodeIds?: string[];
  createCount?: number;
}) {
  const accessFindMany = vi
    .fn()
    .mockResolvedValue((opts.existingIds ?? []).map((id) => ({ id })));
  const createMany = vi.fn().mockResolvedValue({ count: opts.createCount ?? 0 });
  const update = vi.fn().mockResolvedValue({});
  const tx = {
    userStorageAccess: { findMany: accessFindMany, createMany, update },
    user: { findMany: vi.fn().mockResolvedValue((opts.userIds ?? ["u1"]).map((id) => ({ id }))) },
    storageNode: {
      findMany: vi.fn().mockResolvedValue((opts.nodeIds ?? ["n1"]).map((id) => ({ id }))),
    },
  } as unknown as Tx;
  return { tx, createMany, update };
}

describe("importUserStorageAccess", () => {
  it("skips a grant whose user no longer exists", async () => {
    const { tx, createMany } = accessTx({ userIds: [], createCount: 0 });
    const c = counts();

    await importUserStorageAccess(tx, tables({ userStorageAccess: [access()] }), OVERWRITE, c);

    expect(createMany).not.toHaveBeenCalled();
    expect(c).toEqual({ created: 0, updated: 0, skipped: 1 });
  });

  it("skips a grant whose storage node no longer exists", async () => {
    const { tx, createMany } = accessTx({ nodeIds: ["other"], createCount: 0 });
    const c = counts();

    await importUserStorageAccess(tx, tables({ userStorageAccess: [access()] }), OVERWRITE, c);

    expect(createMany).not.toHaveBeenCalled();
    expect(c.skipped).toBe(1);
  });

  it("inserts only the grants whose foreign keys resolve", async () => {
    const { tx, createMany } = accessTx({
      userIds: ["u1"],
      nodeIds: ["n1"],
      createCount: 1,
    });
    const c = counts();

    await importUserStorageAccess(
      tx,
      tables({
        userStorageAccess: [access(), access({ id: "acc-2", userId: "ghost" })],
      }),
      OVERWRITE,
      c,
    );

    const data = createMany.mock.calls[0]?.[0]?.data as { id: string }[];
    expect(data.map((r) => r.id)).toEqual(["acc-1"]);
    expect(c).toEqual({ created: 1, updated: 0, skipped: 1 });
  });

  it("converts quota strings to bigint rather than passing the raw string through", async () => {
    const { tx, createMany } = accessTx({ createCount: 1 });
    const c = counts();

    await importUserStorageAccess(
      tx,
      tables({
        userStorageAccess: [access({ quotaBytes: "10737418240", maxFileBytes: "104857600" })],
      }),
      OVERWRITE,
      c,
    );

    const data = createMany.mock.calls[0]?.[0]?.data as {
      quotaBytes: bigint;
      maxFileBytes: bigint;
    }[];
    expect(data[0]?.quotaBytes).toBe(BigInt(10737418240));
    expect(data[0]?.maxFileBytes).toBe(BigInt(104857600));
  });

  it("aborts the import instead of granting unlimited storage on an unparsable quota", async () => {
    // `null` quotaBytes means "no limit", so a parser that swallowed "10 GB"
    // would hand this user the whole disk.
    const { tx, createMany } = accessTx({ createCount: 1 });
    const c = counts();

    await expect(
      importUserStorageAccess(
        tx,
        tables({ userStorageAccess: [access({ quotaBytes: "10 GB" })] }),
        OVERWRITE,
        c,
      ),
    ).rejects.toThrow(ValidationError);

    expect(createMany).not.toHaveBeenCalled();
  });

  it("aborts on an unparsable quota in the update path too", async () => {
    const { tx, update } = accessTx({ existingIds: ["acc-1"] });
    const c = counts();

    await expect(
      importUserStorageAccess(
        tx,
        tables({ userStorageAccess: [access({ maxFileBytes: "unlimited" })] }),
        OVERWRITE,
        c,
      ),
    ).rejects.toThrow(ValidationError);

    expect(update).not.toHaveBeenCalled();
  });

  it("leaves existing grants untouched when overwriteExisting is off", async () => {
    const { tx, update, createMany } = accessTx({ existingIds: ["acc-1"] });
    const c = counts();

    await importUserStorageAccess(
      tx,
      tables({ userStorageAccess: [access({ quotaBytes: "10 GB" })] }),
      NO_OVERWRITE,
      c,
    );

    // Not even parsed: an untouched row's bad value is not this import's problem.
    expect(update).not.toHaveBeenCalled();
    expect(createMany).not.toHaveBeenCalled();
    expect(c).toEqual({ created: 0, updated: 0, skipped: 1 });
  });
});

// ── importServers / importStorageNodes: optional references ──────────

describe("references to rows that are neither in the package nor here", () => {
  // A customer's package leaves out another customer's SSH key; inserting the
  // server with that id failed on its foreign key and rolled everything back.
  const server = (id: string, sshKeyId: string | null) => ({
    id, name: id, host: `${id}.test`, port: 22, username: "root", sshKeyId, password: null, description: null, tags: [], enabled: true,
    connectionType: "SSH_KEY", publicUrl: null, fileProxyPort: 0, osDialect: null, osInfo: null, createdAt: "2026-01-01T00:00:00.000Z", teamId: "team-b",
  });
  const node = (id: string, serverId: string | null) => ({
    id, name: id, driver: "SFTP", isDefault: false, basePath: "/srv", directAccessMode: "PROXY", publicBaseUrl: null, directAccessExpiresSeconds: 300,
    host: null, port: null, username: null, serverId, healthStatus: "UNKNOWN", createdAt: "2026-01-01T00:00:00.000Z", teamId: "team-b",
  });

  it("creates a server without a key it cannot link, and with one it can", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 3 });
    const tx = {
      sshKey: { findMany: vi.fn().mockResolvedValue([{ id: "key-here" }]) },
      server: { findMany: vi.fn().mockResolvedValue([]), createMany, update: vi.fn() },
    } as unknown as Tx;

    await importServers(tx, tables({ servers: [server("s-gone", "key-gone"), server("s-here", "key-here"), server("s-none", null)] }), OVERWRITE, counts());

    expect(tx.sshKey.findMany).toHaveBeenCalledWith({ where: { id: { in: ["key-gone", "key-here"] } }, select: { id: true } });
    const rows = createMany.mock.calls[0]![0].data as Array<{ id: string; sshKeyId: string | null }>;
    expect(rows.map((row) => [row.id, row.sshKeyId])).toEqual([["s-gone", null], ["s-here", "key-here"], ["s-none", null]]);
  });

  it("leaves an existing server on its key when the package's key cannot be linked", async () => {
    const update = vi.fn().mockResolvedValue({});
    const tx = {
      sshKey: { findMany: vi.fn().mockResolvedValue([{ id: "key-here" }]) },
      server: { findMany: vi.fn().mockResolvedValue([{ id: "s-gone" }, { id: "s-here" }, { id: "s-none" }]), createMany: vi.fn(), update },
    } as unknown as Tx;

    await importServers(tx, tables({ servers: [server("s-gone", "key-gone"), server("s-here", "key-here"), server("s-none", null)] }), OVERWRITE, counts());

    const data = (id: string) => update.mock.calls.find(([call]) => call.where.id === id)![0].data as Record<string, unknown>;
    expect("sshKeyId" in data("s-gone")).toBe(false);
    expect(data("s-here")).toMatchObject({ sshKeyId: "key-here" });
    // The package says "no key": that is restored as such.
    expect(data("s-none")).toMatchObject({ sshKeyId: null });
  });

  it("creates a storage node without a server it cannot link and keeps an existing node's server", async () => {
    const createMany = vi.fn().mockResolvedValue({ count: 2 });
    const update = vi.fn().mockResolvedValue({});
    const storageFindMany = vi.fn()
      .mockResolvedValueOnce([{ id: "n-existing" }]) // which node ids exist
      .mockResolvedValue([]); // default-node normalisation
    const tx = {
      server: { findMany: vi.fn().mockResolvedValue([{ id: "s-here" }]) },
      storageNode: { findMany: storageFindMany, createMany, update, updateMany: vi.fn() },
    } as unknown as Tx;

    await importStorageNodes(tx, tables({ storageNodes: [node("n-gone", "s-gone"), node("n-here", "s-here"), node("n-existing", "s-gone")] }), OVERWRITE, counts());

    const rows = createMany.mock.calls[0]![0].data as Array<{ id: string; serverId?: string | null }>;
    expect(rows.map((row) => [row.id, row.serverId])).toEqual([["n-gone", undefined], ["n-here", "s-here"]]);
    expect("serverId" in update.mock.calls[0]![0].data).toBe(false);
  });
});

// ── importAlertRules ────────────────────────────────────

describe("importAlertRules", () => {
  const rule = (webhookUrl: string | null) => ({ id: "r1", name: "CPU", metric: "cpu", operator: "gt", threshold: 90, durationSeconds: 60, serverIds: [], notifyChannels: ["webhook"], playbookIds: [], webhookUrl, cooldownMinutes: 5, silenceWindows: [], escalationMinutes: 30, onCallUserIds: [], enabled: true, teamId: null, createdAt: "2026-01-01T00:00:00.000Z" });
  const ruleTx = () => {
    const update = vi.fn().mockResolvedValue({});
    return { update, tx: { alertRule: { findMany: vi.fn().mockResolvedValue([{ id: "r1" }]), createMany: vi.fn().mockResolvedValue({ count: 0 }), update } } as unknown as Tx };
  };

  // The standard export leaves webhook addresses out; overwriting from it must not wipe the one the rule has.
  it("keeps a rule's webhook address when a standard export overwrites it", async () => {
    const { tx, update } = ruleTx();
    await importAlertRules(tx, tables({ alertRules: [rule(null)] }), OVERWRITE, counts(), "standard");
    expect(update.mock.calls[0]![0].data).not.toHaveProperty("webhookUrl");
  });

  it("writes the address a full export carries, including none", async () => {
    const { tx, update } = ruleTx();
    await importAlertRules(tx, tables({ alertRules: [rule(null)] }), OVERWRITE, counts(), "full");
    expect(update.mock.calls[0]![0].data).toMatchObject({ webhookUrl: null });
    const second = ruleTx();
    await importAlertRules(second.tx, tables({ alertRules: [rule("https://hooks.example/T0K3N")] }), OVERWRITE, counts(), "standard");
    expect(second.update.mock.calls[0]![0].data).toMatchObject({ webhookUrl: "https://hooks.example/T0K3N" });
  });
});
