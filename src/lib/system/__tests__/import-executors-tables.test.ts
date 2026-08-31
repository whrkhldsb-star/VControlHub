/** @vitest-environment node */
import { describe, expect, it, vi } from "vitest";

import { ValidationError } from "@/lib/errors";
import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";
import type { Counts, Tx } from "../import-executors-helpers";
import { importPermissions } from "../import-executors-rbac";
import { importUserStorageAccess } from "../import-executors-infrastructure";

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
