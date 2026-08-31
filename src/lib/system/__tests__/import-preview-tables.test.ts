/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";

/**
 * The dry-run preview is the only number the operator sees before committing an
 * import, and the Execute button is disabled at `totalRecords === 0`. It must
 * therefore mirror the executors' skip rules exactly: too high and the reported
 * result contradicts the preview, too low and a legitimate import cannot be run
 * at all.
 */

type Row = { id: string } & Record<string, unknown>;

/** Live database contents, keyed by Prisma model. */
const db: Record<string, Row[]> = {};

function model(name: string) {
  return {
    findMany: vi.fn(async ({ where }: { where: Record<string, { in: string[] }> }) => {
      const rows = db[name] ?? [];
      const [field, filter] = Object.entries(where)[0] ?? [];
      if (!field || !filter) return rows;
      const wanted = new Set(filter.in);
      return rows.filter((r) => wanted.has(String(r[field])));
    }),
  };
}

const prismaMock = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({ prisma: prismaMock.value }));

for (const name of [
  "permission",
  "role",
  "rolePermission",
  "user",
  "userRole",
  "sshKey",
  "storageNode",
  "userStorageAccess",
]) {
  prismaMock.value[name] = model(name);
}

const {
  previewPermissions,
  previewUsers,
  previewSshKeys,
  previewRolePermissions,
  previewUserRoles,
  previewUserStorageAccess,
} = await import("../import-preview-tables");

const OVERWRITE = {
  dryRun: true,
  overwriteExisting: true,
  importUsers: true,
  importSettings: true,
} satisfies ImportOptions;
const NO_OVERWRITE = { ...OVERWRITE, overwriteExisting: false } satisfies ImportOptions;
const NO_USERS = { ...OVERWRITE, importUsers: false } satisfies ImportOptions;

function tables(partial: Record<string, unknown>): ExportFile["tables"] {
  return {
    permissions: [],
    roles: [],
    rolePermissions: [],
    users: [],
    userRoles: [],
    sshKeys: [],
    storageNodes: [],
    userStorageAccess: [],
    ...partial,
  } as unknown as ExportFile["tables"];
}

beforeEach(() => {
  for (const key of Object.keys(db)) delete db[key];
});

describe("previewPermissions (secondary unique: key)", () => {
  it("counts a genuinely new row as a create", async () => {
    expect(
      await previewPermissions(tables({ permissions: [{ id: "p1", key: "a:read" }] }), OVERWRITE),
    ).toEqual({ create: 1, update: 0, skip: 0 });
  });

  it("counts a new row whose key a live row already owns as a skip", async () => {
    // The executor refuses this insert rather than violating the unique index,
    // so promising "create" here would over-report the import.
    db.permission = [{ id: "p-live", key: "a:read" }];
    expect(
      await previewPermissions(tables({ permissions: [{ id: "p1", key: "a:read" }] }), OVERWRITE),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("counts an existing row as an update when overwriting", async () => {
    db.permission = [{ id: "p1", key: "a:read" }];
    expect(
      await previewPermissions(tables({ permissions: [{ id: "p1", key: "a:read" }] }), OVERWRITE),
    ).toEqual({ create: 0, update: 1, skip: 0 });
  });

  it("counts an existing row as a skip when not overwriting", async () => {
    db.permission = [{ id: "p1", key: "a:read" }];
    expect(
      await previewPermissions(tables({ permissions: [{ id: "p1", key: "a:read" }] }), NO_OVERWRITE),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("counts an update whose new key belongs to a different live row as a skip", async () => {
    db.permission = [
      { id: "p1", key: "a:read" },
      { id: "p2", key: "b:write" },
    ];
    expect(
      await previewPermissions(tables({ permissions: [{ id: "p1", key: "b:write" }] }), OVERWRITE),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("issues no query for an empty table", async () => {
    const permission = prismaMock.value.permission as ReturnType<typeof model>;
    permission.findMany.mockClear();
    expect(await previewPermissions(tables({}), OVERWRITE)).toEqual({
      create: 0,
      update: 0,
      skip: 0,
    });
    expect(permission.findMany).not.toHaveBeenCalled();
  });
});

describe("previewUsers / previewSshKeys secondary keys", () => {
  it("reads the user's unique key from username, not from a `key` column", async () => {
    db.user = [{ id: "u-live", username: "alice" }];
    expect(
      await previewUsers(tables({ users: [{ id: "u1", username: "alice" }] }), OVERWRITE),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("reads the ssh key's unique key from fingerprint", async () => {
    db.sshKey = [{ id: "k-live", fingerprint: "SHA256:aa" }];
    expect(
      await previewSshKeys(tables({ sshKeys: [{ id: "k1", fingerprint: "SHA256:aa" }] }), OVERWRITE),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("treats a null fingerprint as collision-free rather than as a shared key", async () => {
    db.sshKey = [{ id: "k-live", fingerprint: null }];
    expect(
      await previewSshKeys(
        tables({
          sshKeys: [
            { id: "k1", fingerprint: null },
            { id: "k2", fingerprint: null },
          ],
        }),
        OVERWRITE,
      ),
    ).toEqual({ create: 2, update: 0, skip: 0 });
  });
});

describe("previewRolePermissions (foreign keys)", () => {
  it("accepts a grant whose role and permission exist only in the bundle", async () => {
    // Regression guard: the executors run in dependency order, so both parents
    // exist by the time the grants are written. Checking only the live database
    // would report a first-time import as 0 records and disable Execute.
    expect(
      await previewRolePermissions(
        tables({
          roles: [{ id: "r1", key: "ops" }],
          permissions: [{ id: "p1", key: "a:read" }],
          rolePermissions: [{ roleId: "r1", permissionId: "p1" }],
        }),
      ),
    ).toEqual({ create: 1, update: 0, skip: 0 });
  });

  it("skips a grant pointing at a role that exists nowhere", async () => {
    db.permission = [{ id: "p1", key: "a:read" }];
    expect(
      await previewRolePermissions(
        tables({ rolePermissions: [{ roleId: "ghost", permissionId: "p1" }] }),
      ),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("skips a grant that already exists, and never reports it as an update", async () => {
    db.role = [{ id: "r1" }];
    db.permission = [{ id: "p1" }];
    db.rolePermission = [{ id: "rp1", roleId: "r1", permissionId: "p1" }];
    expect(
      await previewRolePermissions(
        tables({ rolePermissions: [{ roleId: "r1", permissionId: "p1" }] }),
      ),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });
});

describe("previewUserRoles (foreign keys honour importUsers)", () => {
  it("accepts an assignment to a user the same bundle creates", async () => {
    db.role = [{ id: "r1" }];
    expect(
      await previewUserRoles(
        tables({
          users: [{ id: "u1", username: "alice" }],
          userRoles: [{ userId: "u1", roleId: "r1" }],
        }),
        OVERWRITE,
      ),
    ).toEqual({ create: 1, update: 0, skip: 0 });
  });

  it("skips that same assignment when user import is switched off", async () => {
    // importUsers: false means the user is never created, so the assignment
    // would hit a missing FK and be skipped by the executor.
    db.role = [{ id: "r1" }];
    expect(
      await previewUserRoles(
        tables({
          users: [{ id: "u1", username: "alice" }],
          userRoles: [{ userId: "u1", roleId: "r1" }],
        }),
        NO_USERS,
      ),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("still accepts an assignment to an already-live user when user import is off", async () => {
    db.user = [{ id: "u-live", username: "bob" }];
    db.role = [{ id: "r1" }];
    expect(
      await previewUserRoles(
        tables({ userRoles: [{ userId: "u-live", roleId: "r1" }] }),
        NO_USERS,
      ),
    ).toEqual({ create: 1, update: 0, skip: 0 });
  });
});

describe("previewUserStorageAccess", () => {
  it("accepts a grant whose user and node come from the bundle", async () => {
    expect(
      await previewUserStorageAccess(
        tables({
          users: [{ id: "u1", username: "alice" }],
          storageNodes: [{ id: "n1" }],
          userStorageAccess: [{ id: "a1", userId: "u1", storageNodeId: "n1" }],
        }),
        OVERWRITE,
      ),
    ).toEqual({ create: 1, update: 0, skip: 0 });
  });

  it("skips a grant whose storage node exists nowhere", async () => {
    db.user = [{ id: "u1" }];
    expect(
      await previewUserStorageAccess(
        tables({ userStorageAccess: [{ id: "a1", userId: "u1", storageNodeId: "ghost" }] }),
        OVERWRITE,
      ),
    ).toEqual({ create: 0, update: 0, skip: 1 });
  });

  it("counts an existing grant as an update or a skip depending on the option", async () => {
    db.userStorageAccess = [{ id: "a1" }];
    db.user = [{ id: "u1" }];
    db.storageNode = [{ id: "n1" }];
    const bundle = tables({
      userStorageAccess: [{ id: "a1", userId: "u1", storageNodeId: "n1" }],
    });

    expect(await previewUserStorageAccess(bundle, OVERWRITE)).toEqual({
      create: 0,
      update: 1,
      skip: 0,
    });
    expect(await previewUserStorageAccess(bundle, NO_OVERWRITE)).toEqual({
      create: 0,
      update: 0,
      skip: 1,
    });
  });
});
