// @vitest-environment node
import { it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import os from "node:os";
const mocks = vi.hoisted(() => ({
  first: vi.fn(),
  many: vi.fn(),
  shareCreate: vi.fn(),
  shareUnique: vi.fn(),
  shareUpdate: vi.fn(),
  accessLog: vi.fn(),
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({
  tryAcquireAdvisoryLock: async () => async () => {},
}));
vi.mock("@/lib/db", () => ({
  prisma: {
    fileEntry: { findFirst: mocks.first, findMany: mocks.many },
    shareLink: {
      create: mocks.shareCreate,
      findUnique: mocks.shareUnique,
      update: mocks.shareUpdate,
    },
    shareAccessLog: { create: mocks.accessLog },
  },
}));
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: async (
    _r: unknown,
    _o: unknown,
    handler: (context: unknown) => Promise<Response>,
  ) =>
    handler({
      session: { userId: "u", roles: ["admin"], currentTeamId: "team" },
    }),
}));
vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: async () => ({ allowed: true }),
}));
vi.mock("@/lib/auth/team-scope", () => ({
  teamWhere: () => ({ teamId: "team" }),
  teamCreateData: () => ({ teamId: "team" }),
  // share-link/service now branches on the global-team-manager role check.
  isGlobalTeamManager: () => false,
}));
vi.mock("@/lib/http/rate-limit-presets", () => ({
  withRateLimit: async () => ({ allowed: true }),
  rateLimitResponse: vi.fn(),
}));
import { GET } from "../route";
import { GET as publicGet } from "@/app/api/share/[token]/route";
import { createShareLinkFromFileEntry } from "@/lib/share-link/service";
it.each(["authenticated", "public"])(
  "%s archive must exclude soft-deleted descendants",
  async (mode) => {
    const root = await mkdtemp(path.join(os.tmpdir(), "vch-archive-review-"));
    try {
      await mkdir(path.join(root, "docs"));
      await writeFile(path.join(root, "docs/visible.txt"), "visible");
      await writeFile(path.join(root, "docs/removed.txt"), "recycled secret");
      const entries = [
        {
          id: "dir",
          name: "docs",
          relativePath: "docs",
          entryType: "DIRECTORY",
          isDeleted: false,
          storageNodeId: "node",
          storageNode: { id: "node", driver: "LOCAL", basePath: root },
        },
        {
          id: "deleted",
          relativePath: "docs/removed.txt",
          entryType: "FILE",
          isDeleted: true,
        },
      ];
      mocks.first.mockImplementation(
        async ({ where }) =>
          entries.find(
            (e) =>
              (where.id
                ? e.id === where.id
                : e.relativePath === where.relativePath) &&
              (where.isDeleted === undefined ||
                e.isDeleted === where.isDeleted),
          ) ?? null,
      );
      mocks.many.mockResolvedValue([entries[1]]);
      mocks.shareCreate.mockImplementation(async ({ data }) => ({
        ...data,
        id: "share",
        revokedAt: null,
        accessCount: 0,
        storageNode: entries[0]!.storageNode,
      }));
      const created = await createShareLinkFromFileEntry({
        session: {
          userId: "u",
          currentTeamId: "team",
          roles: ["admin"],
        } as never,
        fileEntryId: "dir",
      });
      mocks.shareUnique.mockResolvedValue(created.share);
      const response =
        mode === "authenticated"
          ? await GET(
              new Request(
                "http://localhost/api/storage/archive-download?nodeId=node&path=docs",
              ),
            )
          : await publicGet(
              new Request(
                "http://localhost/api/share/" + created.token + "?archive=1",
              ),
              { params: Promise.resolve({ token: created.token }) },
            );
      expect(response.status).toBe(200);
      const bytes = Buffer.from(await response.arrayBuffer());
      const listing = execFileSync("tar", ["-tzf", "-"], {
        input: bytes,
        encoding: "utf8",
      });
      expect(listing).toContain("docs/visible.txt");
      expect(listing).not.toContain("docs/removed.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  },
);
