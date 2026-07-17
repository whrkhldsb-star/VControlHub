import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, httpRequestMock, loggerMock } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    auditUserAction: vi.fn(),
    assertServerTeamAccess: vi.fn(),
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
vi.mock("@/lib/server/team-access", () => ({
  assertServerTeamAccess: mocks.assertServerTeamAccess,
}));
vi.mock("@/lib/logging", () => ({ createLogger: () => loggerMock }));
vi.mock("node:http", () => ({ default: { request: httpRequestMock } }));

const route = await import("../route");

const session = {
  userId: "u1",
  username: "alice",
  permissions: ["docker:manage"],
  currentTeamId: "team-a",
};

describe("/api/docker/containers audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session });
    mocks.assertServerTeamAccess.mockResolvedValue({
      ok: true as const,
      server: { id: "srv-foreign", teamId: "team-a" },
    });
  });

  it("returns an empty unavailable list without error logging when the Docker socket is missing", async () => {
    httpRequestMock.mockImplementationOnce((_options, _callback) => {
      const requestHandlers: Record<string, (error?: Error) => void> = {};
      const req = {
        on: vi.fn((event: string, handler: (error?: Error) => void) => {
          requestHandlers[event] = handler;
          return req;
        }),
        write: vi.fn(),
        end: vi.fn(() => {
          const error = Object.assign(
            new Error("connect ENOENT /var/run/docker.sock"),
            { code: "ENOENT" },
          );
          requestHandlers.error?.(error);
        }),
        destroy: vi.fn(),
      };
      return req;
    });

    const response = await route.GET(
      new NextRequest("http://local/api/docker/containers"),
    );
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("docker:manage");
    expect(body).toEqual({
      ok: true,
      status: 200,
      data: [],
      dockerAvailable: false,
      message: "Docker is not installed or Docker socket is unavailable",
      dockerScope: {
        scope: "hub-host",
        socketPath: "/var/run/docker.sock",
        warning: expect.stringContaining("not a cross-VPS container console"),
      },
    });
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "Docker socket unavailable",
      expect.any(Error),
      expect.objectContaining({
        apiPath: "/containers/json?all=true",
        method: "GET",
      }),
    );
  });

  it("audits container lifecycle actions without leaking logs or commands", async () => {
    httpRequestMock.mockImplementationOnce((options, callback) => {
      const responseHandlers: Record<string, (chunk?: Buffer) => void> = {};
      const response = {
        statusCode: 204,
        on: vi.fn((event: string, handler: (chunk?: Buffer) => void) => {
          responseHandlers[event] = handler;
        }),
      };
      callback(response);
      responseHandlers.end?.();
      return {
        on: vi.fn(),
        write: vi.fn(),
        end: vi.fn(),
        destroy: vi.fn(),
      };
    });

    const response = await route.POST(
      new NextRequest("http://local/api/docker/containers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "app_1", action: "remove" }),
      }),
    );

    expect(response.status).not.toBe(401);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("docker:manage");
    expect(httpRequestMock).toHaveBeenCalledWith(
      expect.objectContaining({
        path: "/containers/app_1?force=true",
        method: "DELETE",
      }),
      expect.any(Function),
    );
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "docker.container.remove",
      {
        containerId: "app_1",
        serverId: "hub-host",
        status: 204,
        ok: true,
      },
      "WARNING",
    );
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain(
      "/containers/app_1/logs",
    );
  });

  it("rejects remote serverId outside team scope before touching Docker", async () => {
    const { NextResponse } = await import("next/server");
    mocks.assertServerTeamAccess.mockResolvedValueOnce({
      ok: false as const,
      response: NextResponse.json({ error: "Server not found" }, { status: 404 }),
    });

    const response = await route.GET(
      new NextRequest("http://local/api/docker/containers?serverId=srv-foreign"),
    );
    const body = await response.json();

    expect(response.status).toBe(404);
    expect(body).toEqual({ error: "Server not found" });
    expect(mocks.assertServerTeamAccess).toHaveBeenCalledWith(session, "srv-foreign");
    expect(httpRequestMock).not.toHaveBeenCalled();
  });

  it("returns 503 on lifecycle when Docker socket is unavailable (no false success)", async () => {
    httpRequestMock.mockImplementationOnce((_options, _callback) => {
      const requestHandlers: Record<string, (error?: Error) => void> = {};
      const req = {
        on: vi.fn((event: string, handler: (error?: Error) => void) => {
          requestHandlers[event] = handler;
          return req;
        }),
        write: vi.fn(),
        end: vi.fn(() => {
          requestHandlers.error?.(
            Object.assign(new Error("ENOENT"), { code: "ENOENT" }),
          );
        }),
        destroy: vi.fn(),
      };
      return req;
    });

    const response = await route.POST(
      new NextRequest("http://local/api/docker/containers", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "app_1", action: "start" }),
      }),
    );
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.ok).toBe(false);
    expect(body.dockerAvailable).toBe(false);
    expect(mocks.auditUserAction).toHaveBeenCalledWith(
      "u1",
      "docker.container.start",
      expect.objectContaining({ ok: false, status: 503, dockerAvailable: false }),
      "INFO",
    );
  });
});
