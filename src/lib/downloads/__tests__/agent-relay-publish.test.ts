import { expect, it, vi } from "vitest";
import { createAgentFileClient } from "@/lib/storage/agent-file-client";
import { callFileAgent } from "@/lib/storage/agent-file-queue";
import { publishAgentDownloadFile } from "../agent-relay";

const mocks = vi.hoisted(() => ({ snapshot: vi.fn(), lookup: vi.fn(), unlock: vi.fn() }));
vi.mock("@/lib/storage/agent-file-queue", () => ({ callFileAgent: vi.fn(), getFileChannel: async () => ({}) }));
vi.mock("@/lib/auth/execution-actor", () => ({ loadExecutionActor: async () => ({ userId: "actor" }), executionRefusal: async () => null }));
vi.mock("@/lib/storage/archive-access", () => ({ assertNotRecycled: async () => {} }));
vi.mock("@/lib/storage/file-overwrite-lock", () => ({ lockStorageFileOverwrite: async () => mocks.unlock }));
vi.mock("@/lib/storage/file-versions", () => ({ snapshotFileVersionBeforeOverwrite: mocks.snapshot }));
vi.mock("@/lib/storage/access-control", () => ({ assertStorageAccess: async () => ({ allowed: true }), releaseStorageQuotaGuard: async () => {} }));
vi.mock("@/lib/db", () => ({ prisma: { fileEntry: { findUnique: mocks.lookup }, downloadTask: {
  count: async () => 1, findFirstOrThrow: async () => ({ createdBy: "actor", teamId: "team", agentRootIdentity: "root" }),
} } }));

it("refuses directory destinations before Agent staging or relay snapshot and indexing", async () => {
  vi.mocked(callFileAgent).mockResolvedValue({ entry: { isDirectory: true, name: "folder", etag: "v1", size: 0, lastModifiedMs: 1 } });
  await expect(createAgentFileClient("node").write("folder", "")).rejects.toThrow();
  await expect(publishAgentDownloadFile({
    taskId: "download", serverId: "server", nodeId: "node", targetPath: "/", localPath: "unused",
    file: { name: "folder", size: 0, sha256: "f".repeat(64) },
  })).rejects.toThrow();
  expect(vi.mocked(callFileAgent).mock.calls.map(call => call[2].op)).toEqual(["stat", "stat"]);
  expect(mocks.lookup).not.toHaveBeenCalled();
  expect(mocks.snapshot).not.toHaveBeenCalled();
  expect(mocks.unlock).toHaveBeenCalledOnce();
});
