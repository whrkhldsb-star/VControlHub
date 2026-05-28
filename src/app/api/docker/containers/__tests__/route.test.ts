import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks, httpRequestMock, loggerMock } = vi.hoisted(() => ({
  mocks: {
    requireApiSession: vi.fn(),
    isSessionPayload: vi.fn(),
    sessionHasPermission: vi.fn(),
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

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: mocks.requireApiSession,
  isSessionPayload: mocks.isSessionPayload,
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.auditUserAction }));
vi.mock("@/lib/logging", () => ({ createLogger: () => loggerMock }));
vi.mock("node:http", () => ({ default: { request: httpRequestMock } }));

const route = await import("../route");

describe("/api/docker/containers audit coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue({ userId: "u1", username: "alice", permissions: ["docker:manage"] });
    mocks.isSessionPayload.mockReturnValue(true);
    mocks.sessionHasPermission.mockReturnValue(true);
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
          const error = Object.assign(new Error("connect ENOENT /var/run/docker.sock"), { code: "ENOENT" });
          requestHandlers.error?.(error);
        }),
        destroy: vi.fn(),
      };
      return req;
    });

    const response = await route.GET(new NextRequest("http://local/api/docker/containers"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({ ok: true, status: 200, data: [], dockerAvailable: false, message: "Docker 未安装或 Docker socket 不可用" });
    expect(loggerMock.error).not.toHaveBeenCalled();
    expect(loggerMock.warn).toHaveBeenCalledWith("Docker socket unavailable", expect.any(Error), expect.objectContaining({ apiPath: "/containers/json?all=true", method: "GET" }));
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

    const response = await route.POST(new NextRequest("http://local/api/docker/containers", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "app_1", action: "remove" }),
    }));

    expect(response.status).not.toBe(401);
    expect(httpRequestMock).toHaveBeenCalledWith(expect.objectContaining({ path: "/containers/app_1?force=true", method: "DELETE" }), expect.any(Function));
    expect(mocks.auditUserAction).toHaveBeenCalledWith("u1", "docker.container.remove", {
      containerId: "app_1",
      status: 204,
      ok: true,
    }, "WARNING");
    expect(JSON.stringify(mocks.auditUserAction.mock.calls)).not.toContain("/containers/app_1/logs");
  });
});
