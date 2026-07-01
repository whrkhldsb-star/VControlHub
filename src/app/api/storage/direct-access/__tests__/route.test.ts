import { beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

const { requireApiPermissionMock, assertStorageAccessMock, prismaMock } =
  vi.hoisted(() => ({
    requireApiPermissionMock: vi.fn(),
    assertStorageAccessMock: vi.fn(),
    prismaMock: {
      storageNode: {
        findUnique: vi.fn(),
      },
    },
  }));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: requireApiPermissionMock,
}));

vi.mock("@/lib/db", () => ({
  prisma: prismaMock,
}));

vi.mock("@/lib/storage/access-control", () => ({
  assertStorageAccess: assertStorageAccessMock,
}));

import { DELETE, GET, POST } from "../route";

function directNode(overrides: Record<string, unknown> = {}) {
  return {
    basePath: "/data/file",
    driver: "SFTP",
    directAccessMode: "PROXY",
    publicBaseUrl: null,
    directAccessExpiresSeconds: 300,
    ...overrides,
  };
}

describe("/api/storage/direct-access", () => {
  process.env.STORAGE_DIRECT_ACCESS_SECRET = "test-secret";

  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns 403 when the session lacks storage read permission", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ error: "缺少权限" }), { status: 403 }),
    );

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node_1",
          relativePath: "movies/demo.mp4",
        }),
      }),
    );

    expect(response.status).toBe(403);
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({ error: "缺少权限" });
  });

  it("returns 400 when required parameters are missing", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node_1" }),
      }),
    );

    expect(response.status).toBe(400);
    expect(prismaMock.storageNode.findUnique).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toMatchObject({
      code: "VALIDATION_FAILED",
      error: expect.stringContaining("relativePath"),
    });
  });

  it("returns 404 when the storage node does not exist", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(null);

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "missing_node",
          relativePath: "movies/demo.mp4",
        }),
      }),
    );

    expect(response.status).toBe(404);
    expect(prismaMock.storageNode.findUnique).toHaveBeenCalledWith({
      where: { id: "missing_node" },
      select: {
        basePath: true,
        driver: true,
        directAccessMode: true,
        publicBaseUrl: true,
        directAccessExpiresSeconds: true,
      },
    });
    await expect(response.json()).resolves.toMatchObject({
      error: "存储节点不存在",
    });
  });

  it("returns 400 when the target path is the storage root", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(directNode());

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({ nodeId: "node_1", relativePath: "/" }),
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "请求路径超出存储节点根目录",
    });
  });

  it("returns managed SFTP fallback when node is configured for proxy mode", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({
        directAccessMode: "PROXY",
        publicBaseUrl: "https://cdn.example.com/media",
      }),
    );

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node_1",
          relativePath: "movies/demo file.mp4",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({ mode: "managed-download" });
    expect(payload.fallbackUrl).toBe(
      "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo+file.mp4",
    );
  });

  it("returns a short-lived signed storage-server URL when direct mode is enabled", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({
        directAccessMode: "DIRECT",
        publicBaseUrl: "https://cdn.example.com/media/",
        directAccessExpiresSeconds: 600,
      }),
    );

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node_1",
          relativePath: "movies/demo file.mp4",
        }),
      }),
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.mode).toBe("direct-url");
    expect(payload.url).toMatch(
      /^https:\/\/cdn\.example\.com\/media\/movies\/demo%20file\.mp4\?expires=\d+&signature=[a-f0-9]{64}$/,
    );
    expect(payload.fallbackUrl).toBe(
      "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo+file.mp4",
    );
  });

  it("fails closed instead of redirecting when stored direct base URL is private", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({
        directAccessMode: "DIRECT",
        publicBaseUrl: "http://127.0.0.1:31888/files",
      }),
    );

    const response = await GET(
      new Request(
        "https://app.example.com/api/storage/direct-access?nodeId=node_1&path=movies%2Fdemo.mp4",
      ),
    );

    expect(response.status).toBe(500);
    expect(response.headers.get("location")).toBeNull();
    await expect(response.json()).resolves.toMatchObject({
      mode: "managed-download",
      fallbackUrl: "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
    });
  });

  it("falls back to managed SFTP when auto mode lacks a public base URL", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({ directAccessMode: "AUTO" }),
    );

    const response = await POST(
      new Request("https://example.com/api/storage/direct-access", {
        method: "POST",
        body: JSON.stringify({
          nodeId: "node_1",
          relativePath: "movies/demo.mp4",
        }),
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      mode: "managed-download",
    });
  });

  it("redirects GET requests to the generated storage-server URL for file-list links when AUTO health is healthy", async () => {
    vi.clearAllMocks();
    const fetchMock = vi.fn().mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({
        directAccessMode: "AUTO",
        publicBaseUrl: "https://cdn.example.com/media",
        directAccessExpiresSeconds: 600,
      }),
    );

    const response = await GET(
      new Request(
        "https://app.example.com/api/storage/direct-access?nodeId=node_1&path=movies%2Fdemo%20file.mp4",
      ),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(
      /^https:\/\/cdn\.example\.com\/media\/movies\/demo%20file\.mp4\?expires=\d+&signature=[a-f0-9]{64}$/,
    );
    const redirectedUrl = new URL(location);
    const expires = redirectedUrl.searchParams.get("expires") ?? "";
    const expectedSignature = crypto
      .createHmac("sha256", "test-secret")
      .update(`/media/movies/demo file.mp4.${expires}`)
      .digest("hex");
    expect(redirectedUrl.searchParams.get("signature")).toBe(expectedSignature);
    expect(fetchMock).toHaveBeenCalledWith(new URL("https://cdn.example.com/__vch_health"), expect.objectContaining({ method: "GET" }));
  });

  it("falls back to managed SFTP when AUTO direct gateway health is unavailable", async () => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 503 })));
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({
        directAccessMode: "AUTO",
        publicBaseUrl: "https://cdn.example.com/media",
        directAccessExpiresSeconds: 600,
      }),
    );

    const response = await GET(
      new Request(
        "https://app.example.com/api/storage/direct-access?nodeId=node_1&path=movies%2Fdemo.mp4",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
    );
  });

  it("redirects GET requests to the managed SFTP fallback when direct access is unavailable", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({ directAccessMode: "PROXY" }),
    );

    const response = await GET(
      new Request(
        "https://app.example.com/api/storage/direct-access?nodeId=node_1&path=movies%2Fdemo.mp4",
      ),
    );

    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "/api/storage/sftp-download?nodeId=node_1&path=movies%2Fdemo.mp4",
    );
  });

  it("redirects forced-download GET requests through direct access when VPS direct mode is enabled", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });
    assertStorageAccessMock.mockResolvedValueOnce({ allowed: true });
    prismaMock.storageNode.findUnique.mockResolvedValueOnce(
      directNode({
        directAccessMode: "DIRECT",
        publicBaseUrl: "https://cdn.example.com/media",
        directAccessExpiresSeconds: 600,
      }),
    );

    const response = await GET(
      new Request(
        "https://app.example.com/api/storage/direct-access?nodeId=node_1&path=movies%2Fdemo.mp4&download=1",
      ),
    );

    expect(response.status).toBe(302);
    const location = response.headers.get("location") ?? "";
    expect(location).toMatch(
      /^https:\/\/cdn\.example\.com\/media\/movies\/demo\.mp4\?expires=\d+&signature=[a-f0-9]{64}&download=1$/,
    );
  });

  it("keeps DELETE as an authenticated no-op for old clients", async () => {
    vi.clearAllMocks();
    requireApiPermissionMock.mockResolvedValueOnce({
      session: { userId: "u_1", username: "admin" },
    });

    const response = await DELETE(
      new Request("http://local/api/storage/direct-access", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      stopped: true,
      mode: "managed-download",
    });
  });
});
