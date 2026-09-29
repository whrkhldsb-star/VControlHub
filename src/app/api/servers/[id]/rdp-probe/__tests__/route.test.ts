/**
 * GET /api/servers/[id]/rdp-probe
 *
 * The route is the Windows card's reachability source: a single TCP connect
 * against host:port (the RDP endpoint, 3389 by default) with no credentials
 * and no RDP handshake. Properties under test: the DB lookup stays team- and
 * enabled-scoped, non-Windows or invisible servers answer 404 (not a probe
 * result), and the transport outcome maps straight through the
 * probeTcpReachable seam (mocking node:net at module level proved unreliable
 * under vitest — the seam is the testable boundary).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const { findFirstMock, probeMock, teamWhereMarker } = vi.hoisted(() => ({
  findFirstMock: vi.fn(),
  probeMock: vi.fn(),
  teamWhereMarker: { marker: "team-scope-read" },
}));

vi.mock("@/lib/db", () => ({
  prisma: { server: { findFirst: findFirstMock } },
}));

// Mirrors the real guard's contract for this route: auth-only wrapper whose
// typed errors (NotFoundError.status=404) surface as error responses.
vi.mock("@/lib/http/api-guard", () => ({
  withApiRoute: vi.fn(async (_request, _options, handler) => {
    try {
      return await handler({ session: { userId: "u_1", username: "admin" } });
    } catch (error) {
      const status =
        error instanceof Error && "status" in error
          ? Number((error as { status?: number }).status)
          : 500;
      const message = error instanceof Error ? error.message : "probe failed";
      return Response.json({ error: message }, { status });
    }
  }),
}));

vi.mock("@/lib/auth/team-scope", () => ({
  serverTeamWhere: vi.fn(() => teamWhereMarker),
}));

vi.mock("@/lib/i18n/api-copy", () => ({
  apiCopy: (key: string) => key,
}));

vi.mock("@/lib/net/tcp-reachable", () => ({
  probeTcpReachable: probeMock,
}));

import { GET } from "../route";

const windowsServer = {
  id: "srv_win",
  host: "192.0.2.10",
  port: 3389,
  operatingSystem: "WINDOWS",
};

function request(id = "srv_win") {
  return {
    req: new Request(`http://local/api/servers/${id}/rdp-probe`, { method: "GET" }),
    ctx: { params: Promise.resolve({ id }) },
  };
}

describe("GET /api/servers/[id]/rdp-probe", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    findFirstMock.mockResolvedValue(windowsServer);
    probeMock.mockResolvedValue({ reachable: true, latencyMs: 12 });
  });

  it("reports reachability with latency when the TCP connect succeeds", async () => {
    const { req, ctx } = request();
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ reachable: true, latencyMs: 12 });
    expect(probeMock).toHaveBeenCalledWith({ host: "192.0.2.10", port: 3389, timeoutMs: 5_000 });
  });

  it("passes an unreachable outcome through without inventing latency", async () => {
    probeMock.mockResolvedValue({ reachable: false, latencyMs: null });
    const { req, ctx } = request();
    const res = await GET(req, ctx);
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toEqual({ reachable: false, latencyMs: null });
  });

  it("surfaces a transport failure from the probe seam as unreachable", async () => {
    probeMock.mockResolvedValue({ reachable: false, latencyMs: null });
    const { req, ctx } = request();
    const res = await GET(req, ctx);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ reachable: false, latencyMs: null });
  });

  it("404s a server outside the caller's scope without touching the network", async () => {
    findFirstMock.mockResolvedValueOnce(null);
    const { req, ctx } = request("srv-other");
    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("404s a Linux server — RDP probing is a Windows-only transport", async () => {
    findFirstMock.mockResolvedValueOnce({ ...windowsServer, operatingSystem: "LINUX" });
    const { req, ctx } = request();
    const res = await GET(req, ctx);

    expect(res.status).toBe(404);
    expect(probeMock).not.toHaveBeenCalled();
  });

  it("scopes the lookup to enabled servers within the caller's read scope", async () => {
    const { req, ctx } = request("srv-42");
    await GET(req, ctx);

    expect(findFirstMock).toHaveBeenCalledWith({
      where: { AND: [{ id: "srv-42", enabled: true }, teamWhereMarker] },
      select: { id: true, host: true, port: true, operatingSystem: true },
    });
  });
});
