import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const {
  enqueueJobMock,
  withApiRouteMock,
  listSftpNodesForStaleInventoryMock,
  detectAndPruneSftpStaleInventoryMock,
  apiCatchMock,
} = vi.hoisted(() => ({
  enqueueJobMock: vi.fn(),
  withApiRouteMock: vi.fn(),
  listSftpNodesForStaleInventoryMock: vi.fn(),
  detectAndPruneSftpStaleInventoryMock: vi.fn(),
  apiCatchMock: vi.fn(),
}));

vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: withApiRouteMock,
}));

vi.mock("@/lib/http/api-error", () => ({
  apiCatch: apiCatchMock,
}));

vi.mock("@/lib/job/service", () => ({
  enqueueJob: enqueueJobMock,
}));

vi.mock("@/lib/storage/sftp-stale-inventory", () => ({
  listSftpNodesForStaleInventory: listSftpNodesForStaleInventoryMock,
  detectAndPruneSftpStaleInventory: detectAndPruneSftpStaleInventoryMock,
}));

import { POST } from "../route";

const session = { userId: "u_1", username: "admin", roles: ["admin"] };
const sampleNode = {
  id: "node_1",
  name: "remote",
  driver: "SFTP",
  basePath: "/data/files",
  healthStatus: "HEALTHY",
  lastHealthError: null,
  host: "203.0.113.10",
  port: 22,
  username: "root",
  server: {
    id: "srv_1",
    host: "203.0.113.10",
    port: 22,
    username: "root",
    connectionType: "PASSWORD",
    password: "secret",
    sshKey: null,
  },
};

function postRequest(body: Record<string, unknown>, search = "") {
  return new NextRequest(
    `https://example.test/api/storage/sftp-stale-inventory${search}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
  );
}

describe("/api/storage/sftp-stale-inventory", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Mimic withApiRoute: run handler, catch thrown errors via apiCatch
    withApiRouteMock.mockImplementation(async (_request, _options, handler) => {
      try {
        return await handler({ session, body: _options.bodySchema ? undefined : undefined });
      } catch (error) {
        return apiCatchMock(error);
      }
    });
    listSftpNodesForStaleInventoryMock.mockResolvedValue([sampleNode]);
    enqueueJobMock.mockResolvedValue({ id: "job_42", status: "PENDING" });
    apiCatchMock.mockImplementation((error: unknown) => {
      if (error && typeof error === "object" && "name" in error) {
        const e = error as { name?: string; message?: string };
        if (e.name === "NotFoundError") {
          return new Response(JSON.stringify({ error: e.message }), { status: 404 });
        }
        if (e.name === "ValidationError") {
          return new Response(JSON.stringify({ error: e.message }), { status: 400 });
        }
      }
      return new Response(JSON.stringify({ error: "server error" }), { status: 500 });
    });
  });

  it("queues a durable job for a single node by default", async () => {
    withApiRouteMock.mockImplementation(async (_request, _options, handler) =>
      handler({ session, body: { nodeId: "node_1" } }),
    );

    const response = await POST(postRequest({ nodeId: "node_1" }));

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      queued: true,
      jobId: "job_42",
      taskId: "job:job_42",
      message: expect.stringContaining("后台任务"),
    });
    expect(enqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "storage.sftp-stale-inventory",
        payload: expect.objectContaining({
          nodeId: "node_1",
          reason: "api",
        }),
        createdBy: "u_1",
        targetStorageNodeId: "node_1",
      }),
    );
    expect(detectAndPruneSftpStaleInventoryMock).not.toHaveBeenCalled();
  });

  it("queues a durable job for all SFTP nodes when no nodeId is provided", async () => {
    withApiRouteMock.mockImplementation(async (_request, _options, handler) =>
      handler({ session, body: {} }),
    );

    const response = await POST(postRequest({}));

    expect(response.status).toBe(202);
    expect(enqueueJobMock).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ nodeId: undefined }),
        targetStorageNodeId: null,
      }),
    );
  });

  it("runs the scan synchronously when wait=1", async () => {
    withApiRouteMock.mockImplementation(async (_request, _options, handler) =>
      handler({ session, body: { nodeId: "node_1", dryRun: true } }),
    );
    detectAndPruneSftpStaleInventoryMock.mockResolvedValueOnce({
      nodeId: "node_1",
      nodeName: "remote",
      basePath: "/data/files",
      scanned: 12,
      stale: 3,
      errors: [],
      durationMs: 200,
      dryRun: true,
    });

    const response = await POST(postRequest({ nodeId: "node_1" }, "?wait=1"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      queued: false,
      totals: { scanned: 12, stale: 3, errors: 0, durationMs: 200 },
      results: [
        expect.objectContaining({ nodeId: "node_1", stale: 3, dryRun: true }),
      ],
    });
    expect(enqueueJobMock).not.toHaveBeenCalled();
  });

  it("returns a not-found error when the node does not exist", async () => {
    withApiRouteMock.mockImplementation(async (_request, _options, handler) => {
      try {
        return await handler({ session, body: { nodeId: "node_missing" } });
      } catch (error) {
        return apiCatchMock(error);
      }
    });
    listSftpNodesForStaleInventoryMock.mockResolvedValueOnce([]);

    const response = await POST(postRequest({ nodeId: "node_missing" }));

    expect(response.status).toBe(404);
  });

  it("rejects invalid payloads (maxDepth out of range)", async () => {
    withApiRouteMock.mockImplementation(async (_request, _options, handler) => {
      try {
        return await handler({ session, body: { maxDepth: 99 } });
      } catch (error) {
        return apiCatchMock(error);
      }
    });

    const response = await POST(postRequest({ maxDepth: 99 }));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: expect.stringContaining("输入参数无效"),
    });
  });
});
