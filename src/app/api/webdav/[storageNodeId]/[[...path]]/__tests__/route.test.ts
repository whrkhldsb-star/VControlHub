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
    UnknownWebDavTokenError: actual.UnknownWebDavTokenError,
    webDavUnauthorizedResponse: actual.webDavUnauthorizedResponse,
  };
});
vi.mock("@/lib/webdav/handler", async () => {
  const actual = await import("@/lib/webdav/handler");
  return {
    normalizeWebDavRelativePath: actual.normalizeWebDavRelativePath,
    handleWebDavOptions: actual.handleWebDavOptions,
    handleWebDavLock: actual.handleWebDavLock,
    handleWebDavUnlock: actual.handleWebDavUnlock,
    handleWebDavPropPatch: actual.handleWebDavPropPatch,
    WEBDAV_ALLOW_HEADER: actual.WEBDAV_ALLOW_HEADER,
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
    // Every handler answers with a Response; the route adds headers to it.
    mocks.put.mockResolvedValue(new Response(null, { status: 201 }));
    mocks.del.mockResolvedValue(new Response(null, { status: 204 }));
    mocks.mkcol.mockResolvedValue(new Response(null, { status: 201 }));
    mocks.move.mockResolvedValue(new Response(null, { status: 201 }));
    mocks.copy.mockResolvedValue(new Response(null, { status: 201 }));
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

  // The request limit is per path, so a caller presenting tokens that do not exist could rotate paths for a
  // fresh budget of token lookups. After 60 such tokens the client is refused for a while, on every path.
  it("refuses a client that keeps presenting tokens that do not exist, whatever the path", async () => {
    const { UnknownWebDavTokenError } = await import("@/lib/webdav/auth");
    mocks.authenticateWebDavRequest.mockRejectedValue(new UnknownWebDavTokenError("unknown"));
    const guess = (ip: string, path: string) => GET(req("GET", { authorization: "Bearer vch_guess", "x-forwarded-for": ip }, path), params([path]));
    for (let i = 0; i < 60; i++) expect((await guess("198.51.100.7", `p${i}.txt`)).status).toBe(401);

    const refused = await guess("198.51.100.7", "other.txt");
    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(mocks.authenticateWebDavRequest).toHaveBeenCalledTimes(60);
    // Another client, and a request that only asks how to sign in, are answered as before.
    expect((await guess("198.51.100.8", "a.txt")).status).toBe(401);
    expect((await GET(req("GET", { "x-forwarded-for": "198.51.100.7" }), params(["a.txt"]))).status).toBe(401);
  });

  it("counts nothing for a client without a trusted address: one shared counter would lock everyone out", async () => {
    const { UnknownWebDavTokenError } = await import("@/lib/webdav/auth");
    mocks.authenticateWebDavRequest.mockRejectedValue(new UnknownWebDavTokenError("unknown"));
    let status = 0;
    for (let i = 0; i < 70; i++) status = (await GET(req("GET", { authorization: "Bearer vch_guess" }, `u${i}.txt`), params([`u${i}.txt`]))).status;
    expect(status).toBe(401);
  });

  it("does not count a real token that may not do what was asked", async () => {
    const { AuthError } = await import("@/lib/errors");
    mocks.authenticateWebDavRequest.mockRejectedValue(new AuthError("insufficient"));
    let status = 0;
    for (let i = 0; i < 70; i++) {
      status = (await PUT(req("PUT", { authorization: "Bearer vch_read_only", "x-forwarded-for": "198.51.100.9" }, `w${i}.txt`), params([`w${i}.txt`]))).status;
    }
    expect(status).toBe(401);
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
    // Next.js has decoded the catch-all segments already ("a%20b.txt" in the URL arrives as "a b.txt").
    await GET(req("GET", { range: "bytes=0-9" }, "dir/a%20b.txt"), params(["dir", "a b.txt"]));

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

  it("does not decode the segments a second time: a file name holding %XX stays itself", async () => {
    // report%201.pdf on disk is requested as report%25201.pdf; Next hands the route "report%201.pdf".
    await GET(req("GET", {}, "dir/report%25201.pdf"), params(["dir", "report%201.pdf"]));

    expect(mocks.getHead).toHaveBeenCalledWith(
      expect.objectContaining({ relativePath: "dir/report%201.pdf" }),
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
    // LOCK is served now (A4-16); REPORT is still not.
    const response = await POST(req("POST", { "x-http-method-override": "REPORT" }), params(["a.txt"]));

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toContain("PROPFIND");
  });

  it("answers 400 for a path the normalizer refuses, without reaching a handler", async () => {
    // Thrown outside the try, it escaped as an unhandled 500.
    const response = await GET(req("GET", {}, "..%2Fetc"), params(["..", "etc"]));
    expect(response.status).toBe(400);
    expect(mocks.getHead).not.toHaveBeenCalled();
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

  it("does not trust error names or access-denied text for untyped failures", async () => {
    const denial = new Error("storage access denied");
    denial.name = "BusinessError";
    mocks.getHead.mockRejectedValue(denial);

    const response = await GET(req("GET"), params(["a.txt"]));

    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain("storage access denied");
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

  // The proxy does not run on this route (see `config.matcher` in src/proxy.ts),
  // so what it adds to every other response is added by the route.
  describe("response headers the proxy would have added", () => {
    it("adds the baseline to every answer, refusals included", async () => {
      mocks.propFind.mockResolvedValue(new Response("<multistatus/>", { status: 207, headers: { DAV: "1" } }));
      const listing = await POST(req("POST", { "x-http-method-override": "PROPFIND" }), params(["a.txt"]));
      const { AuthError } = await import("@/lib/errors");
      mocks.authenticateWebDavRequest.mockRejectedValueOnce(new AuthError("nope"));
      const challenge = await GET(req("GET"), params(["a.txt"]));
      const options = await OPTIONS(req("OPTIONS"), params());

      for (const response of [listing, challenge, options]) {
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
        expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
        expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
        expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=");
      }
      // The handler's own headers and body are kept.
      expect(listing.status).toBe(207);
      expect(listing.headers.get("DAV")).toBe("1");
      expect(await listing.text()).toBe("<multistatus/>");
      expect(challenge.headers.get("WWW-Authenticate")).toContain("Basic");
      expect(options.status).toBe(204);
    });

    it("keeps a file's own sandbox policy", async () => {
      mocks.getHead.mockResolvedValue(
        new Response("<script>alert(1)</script>", {
          status: 200,
          headers: { "Content-Type": "text/html", "Content-Security-Policy": "sandbox", "X-Content-Type-Options": "nosniff" },
        }),
      );

      const response = await GET(req("GET"), params(["a.html"]));

      expect(response.headers.get("Content-Security-Policy")).toBe("sandbox");
      expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
    });

    it("promises HTTPS only on an HTTPS request", async () => {
      const plain = await GET(new Request("http://hub.example/api/webdav/n1/a.txt"), params(["a.txt"]));
      expect(plain.headers.get("Strict-Transport-Security")).toBeNull();

      const forwarded = await GET(
        new Request("http://hub.example/api/webdav/n1/a.txt", { headers: { "x-forwarded-proto": "https" } }),
        params(["a.txt"]),
      );
      expect(forwarded.headers.get("Strict-Transport-Security")).toContain("max-age=");
    });
  });
});
