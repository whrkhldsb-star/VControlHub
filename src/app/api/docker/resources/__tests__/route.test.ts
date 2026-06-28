import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, httpRequestMock, loggerMock } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    auditUserAction: vi.fn(),
  },
  httpRequestMock: vi.fn(),
  loggerMock: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: mocks.requireApiPermission,
}));
vi.mock("@/lib/audit/service", () => ({
  auditUserAction: mocks.auditUserAction,
}));
vi.mock("@/lib/logging", () => ({ createLogger: () => loggerMock }));
vi.mock("node:http", () => ({ default: { request: httpRequestMock } }));

const route = await import("../route");

const session = {
  userId: "u1",
  username: "alice",
  permissions: ["docker:manage"],
};

function mockDockerResponse(statusCode: number, data: unknown) {
  httpRequestMock.mockImplementationOnce((_options, callback) => {
    const handlers: Record<string, (chunk?: Buffer) => void> = {};
    const response = {
      statusCode,
      on: vi.fn((event: string, handler: (chunk?: Buffer) => void) => {
        handlers[event] = handler;
      }),
    };
    callback(response);
    handlers.data?.(Buffer.from(JSON.stringify(data)));
    handlers.end?.();
    return { on: vi.fn(), write: vi.fn(), end: vi.fn(), destroy: vi.fn() };
  });
}

describe("/api/docker/resources", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
  });

  it("lists Docker networks", async () => {
    mockDockerResponse(200, [{ Name: "bridge", Id: "net1", Driver: "bridge" }]);

    const response = await route.GET(new NextRequest("http://local/api/docker/resources?type=networks"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("docker:manage");
    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/networks", method: "GET" }),
      expect.any(Function),
    );
    expect(body).toMatchObject({ ok: true, status: 200, data: [{ Name: "bridge" }] });
  });

  it("creates a Docker volume and audits the action", async () => {
    mockDockerResponse(201, { Name: "cache", Driver: "local" });

    const response = await route.POST(
      new NextRequest("http://local/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "volumes", action: "create", name: "cache" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/volumes/create", method: "POST" }),
      expect.any(Function),
    );
    const request = httpRequestMock.mock.results[0]!.value;
    expect(request.write).toHaveBeenCalledWith(JSON.stringify({ Name: "cache", Driver: "local" }));
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "docker.volume.create",
      { name: "cache", driver: "local", status: 201, ok: true },
      "INFO",
    );
  });

  it("deletes a Docker network with confirmation-grade audit severity", async () => {
    mockDockerResponse(204, null);

    const response = await route.POST(
      new NextRequest("http://local/api/docker/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "networks", action: "delete", name: "old_net" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({ path: "/networks/old_net", method: "DELETE" }),
      expect.any(Function),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "docker.network.delete",
      { name: "old_net", driver: "local", status: 204, ok: true },
      "WARNING",
    );
  });

  it("returns unavailable state without error logging when Docker socket is missing", async () => {
    httpRequestMock.mockImplementationOnce((_options, _callback) => {
      const handlers: Record<string, (error?: Error) => void> = {};
      const req = {
        on: vi.fn((event: string, handler: (error?: Error) => void) => {
          handlers[event] = handler;
          return req;
        }),
        write: vi.fn(),
        end: vi.fn(() => {
          handlers.error?.(Object.assign(new Error("ENOENT"), { code: "ENOENT" }));
        }),
        destroy: vi.fn(),
      };
      return req;
    });

    const response = await route.GET(new NextRequest("http://local/api/docker/resources?type=volumes"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ dockerAvailable: false, data: { networks: [], volumes: [] } });
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalled();
  });
});
