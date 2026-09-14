// @vitest-environment node
import { randomUUID } from "node:crypto";
import { PassThrough } from "node:stream";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { prisma } from "@/lib/db";
import {
  closeAdvisoryLockPoolForTests,
  tryAcquireAdvisoryLock,
} from "@/lib/concurrency/advisory-lock";
import { openManagedArchive } from "../archive-access";

describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")(
  "archive access PostgreSQL integration",
  () => {
    const nodeId = `archive-test-${randomUUID()}`;
    let created = false;
    beforeAll(async () => {
      const database = new URL(process.env.DATABASE_URL!);
      if (
        !["127.0.0.1", "localhost", "[::1]"].includes(database.hostname) ||
        !/audit|test|whrkhldsb_ci/.test(database.pathname)
      )
        throw new Error(
          "Archive integration requires a loopback test database",
        );
      await prisma.storageNode.create({
        data: {
          id: nodeId,
          name: nodeId,
          driver: "LOCAL",
          basePath: "/unused-archive-test",
        },
      });
      created = true;
      await prisma.fileEntry.createMany({
        data: [
          {
            storageNodeId: nodeId,
            relativePath: "docs",
            name: "docs",
            entryType: "DIRECTORY",
          },
          {
            storageNodeId: nodeId,
            relativePath: "docs/trash",
            name: "trash",
            entryType: "DIRECTORY",
            isDeleted: true,
          },
          {
            storageNodeId: nodeId,
            relativePath: "docs/visible.txt",
            name: "visible.txt",
            entryType: "FILE",
          },
        ],
      });
    });
    afterAll(async () => {
      if (created) await prisma.storageNode.delete({ where: { id: nodeId } });
      await closeAdvisoryLockPoolForTests();
      await prisma.$disconnect();
    });

    it("reads real deletion rows while excluding concurrent mutation lock holders", async () => {
      const controller = new AbortController();
      const stream = new PassThrough();
      const open = vi.fn(() => stream);
      try {
        await openManagedArchive({
          storageNodeId: nodeId,
          relativePath: "docs",
          signal: controller.signal,
          open,
        });
        expect(open).toHaveBeenCalledWith(["docs/trash"]);
        const concurrent = await tryAcquireAdvisoryLock(
          "storage-file-operation",
          nodeId,
        );
        await concurrent?.();
        expect(concurrent).toBeNull();
      } finally {
        controller.abort();
      }
      let released: (() => Promise<void>) | null = null;
      try {
        await vi.waitFor(async () => {
          released = await tryAcquireAdvisoryLock(
            "storage-file-operation",
            nodeId,
          );
          expect(released).not.toBeNull();
        });
      } finally {
        await (released as (() => Promise<void>) | null)?.();
      }
    });

    it("refuses a root which entered the recycle bin before its download acquired the lock", async () => {
      await prisma.fileEntry.update({
        where: {
          storageNodeId_relativePath: {
            storageNodeId: nodeId,
            relativePath: "docs",
          },
        },
        data: { isDeleted: true },
      });
      const open = vi.fn(() => new PassThrough());
      await expect(
        openManagedArchive({
          storageNodeId: nodeId,
          relativePath: "docs",
          signal: new AbortController().signal,
          open,
        }),
      ).rejects.toThrow();
      expect(open).not.toHaveBeenCalled();
    });
  },
);
