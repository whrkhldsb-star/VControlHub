/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * WebDAV dispatch layer. `/api/webdav/` is a public prefix in src/proxy.ts and
 * the route authenticates itself, so the ordering asserted here matters: the
 * rate limit has to run before the token lookup, or an anonymous caller gets one
 * indexed DB read per request for free.
 */

const mocks = vi.hoisted(() => ({
  withRateLimit: vi.fn(),
  authenticateWebDavRequest: vi.fn(),
  propFind: vi.fn(),
  getHead: vi.fn(),
  put: vi.fn(),
  del: vi.fn(),
  mkcol: vi.fn(),
  move: vi.fn(),
  copy: vi.fn(),
  logWarn: vi.fn(),
}));

vi.mock("@/lib/http/rate-limit-presets", async () => {
  const actual = await import("@/lib/http/rate-limit-presets");
  return { WEBDAV_LIMIT: actual.WEBDAV_LIMIT, withRateLimit: mocks.withRateLimit };
});
vi.mock("@/lib/webdav/auth", async () => {
  const actual = await import("@/lib/webdav/auth");
  return {
    authenticateWebDavRequest: mocks.authenticateWebDavRequest,
    webDavUnauthorizedResponse: actual.webDavUnauthorizedResponse,
  };
});
vi.mock("@/lib/webdav/handler", async () => {
  const actual = await import("@/lib/webdav/handler");
  return {
    normalizeWebDavRelativePath: actual.normalizeWebDavRelativePath,
    handleWebDavOptions: actual.handleWebDavOptions,
    handleWebDavPropFind: mocks.propFind,
    handleWebDavGetHead: mocks.getHead,
    handleWebDavPut: mocks.put,
    handleWebDavDelete: mocks.del,
    handleWebDavMkcol: mocks.mkcol,
    handleWebDavMove: mocks.move,
    handleWebDavCopy: mocks.copy,
  };
});
vi.mock("@/lib/logging", () => ({
  createLogger: () => ({ info: vi.fn(), warn: mocks.logWarn, error: vi.fn(), debug: vi.fn() }),
}));
vi.mock("@/lib/i18n/service-translations", () => ({ t: (key: string) => key }));

const { GET, OPTIONS, POST, PUT } = await import("../route");

const SESSION = { userId: "u1", username: "alice", roles: ["operator"], currentTeamId: "team_a" };

function params(path?: string[]) {
  return { params: Promise.resolve({ storageNodeId: "n1", path }) };
}

function req(method: string, headers: Record<string, string> = {}, path = "a.txt") {
  return new Request(`https://hub.example/api/webdav/n1/${path}`, { method, headers });
}

describe("webdav route dispatch", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0 });
    mocks.authenticateWebDavRequest.mockResolvedValue({ session: SESSION });
    mocks.getHead.mockResolvedValue(new Response("ok", { status: 200 }));
    mocks.propFind.mockResolvedValue(new Response("<multistatus/>", { status: 207 }));
  });

  it("rate limits before authenticating", async () => {
    mocks.withRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 4200 });

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("5");
    // The whole point of the pre-auth placement.
    expect(mocks.authenticateWebDavRequest).not.toHaveBeenCalled();
  });

  it("never rounds Retry-After down to zero", async () => {
    mocks.withRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 10 });

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.headers.get("Retry-After")).toBe("1");
  });

  it("answers OPTIONS without a rate-limit slot or credentials", async () => {
    const response = await OPTIONS(req("OPTIONS"), params());

    expect(response.status).toBe(204);
    expect(response.headers.get("DAV")).toContain("1");
    expect(mocks.withRateLimit).not.toHaveBeenCalled();
    expect(mocks.authenticateWebDavRequest).not.toHaveBeenCalled();
  });

  it("turns an AuthError into a 401 that advertises Basic", async () => {
    const { AuthError } = await import("@/lib/errors");
    mocks.authenticateWebDavRequest.mockRejectedValue(new AuthError("nope"));

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
  });

  it("propagates a non-AuthError from authentication", async () => {
    mocks.authenticateWebDavRequest.mockRejectedValue(new Error("db down"));

    await expect(GET(req("GET"), params(["a.txt"]))).rejects.toThrow("db down");
  });

  it("dispatches an overridden verb and passes the method to authentication", async () => {
    await POST(
      req("POST", { "x-http-method-override": "propfind", depth: "1" }),
      params(["dir"]),
    );

    // Scope selection depends on the effective verb, not the transport verb.
    expect(mocks.authenticateWebDavRequest).toHaveBeenCalledWith(expect.anything(), "PROPFIND");
    expect(mocks.propFind).toHaveBeenCalledWith(expect.anything(), "1");
    expect(mocks.getHead).not.toHaveBeenCalled();
  });

  it("ignores a whitespace-only override", async () => {
    await PUT(req("PUT", { "x-http-method-override": "   " }), params(["a.txt"]));

    expect(mocks.put).toHaveBeenCalled();
  });

  it("builds the context from the route params and Range header", async () => {
    await GET(req("GET", { range: "bytes=0-9" }, "dir/a%20b.txt"), params(["dir", "a%20b.txt"]));

    expect(mocks.getHead).toHaveBeenCalledWith(
      expect.objectContaining({
        session: SESSION,
        storageNodeId: "n1",
        relativePath: "dir/a b.txt",
        rangeHeader: "bytes=0-9",
      }),
      "GET",
    );
  });

  it("treats a missing path segment as the node root", async () => {
    await GET(req("GET", {}, ""), params());

    expect(mocks.getHead).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "" }),
      "GET",
    );
  });

  it("answers 405 with an Allow header for an unsupported verb", async () => {
    const response = await POST(req("POST", { "x-http-method-override": "LOCK" }), params(["a.txt"]));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toContain("PROPFIND");
  });

  it("maps a typed AppError to its own status", async () => {
    const { NotFoundError } = await import("@/lib/errors");
    mocks.getHead.mockRejectedValue(new NotFoundError("backend.webdav.resourceNotFound"));

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(404);
    expect(await response.text()).toBe("backend.webdav.resourceNotFound");
  });

  it("keeps a BusinessError's own status instead of guessing from the message", async () => {
    // 422 (BusinessError's default), not the 403 the message-matching fallback
    // would have produced: the typed status wins by design. RFC 4918 defines 422,
    // so clients treat it as a hard failure either way.
    const { BusinessError } = await import("@/lib/errors");
    mocks.getHead.mockRejectedValue(new BusinessError("storage access denied"));

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(422);
  });

  it("still falls back to message matching for an untyped access denial", async () => {
    const denial = new Error("storage access denied");
    denial.name = "BusinessError";
    mocks.getHead.mockRejectedValue(denial);

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(403);
  });

  it("falls back to 500 and logs for an untyped failure", async () => {
    mocks.getHead.mockRejectedValue(new Error("boom"));

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(500);
    expect(mocks.logWarn).toHaveBeenCalledWith(
      "webdav request failed",
      expect.objectContaining({ method: "GET", status: 500, path: "a.txt" }),
    );
  });

  it("re-challenges rather than leaking a 401 body", async () => {
    const { AuthError } = await import("@/lib/errors");
    mocks.getHead.mockRejectedValue(new AuthError("session expired"));

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(401);
    expect(response.headers.get("WWW-Authenticate")).toContain("Basic");
    expect(await response.text()).not.toContain("session expired");
  });
});
