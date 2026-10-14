import { describe, expect, it, vi } from "vitest";
import { NextRequest, type NextResponse } from "next/server";

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

import { PUBLIC_NODE_NOT_FOUND_PATH, proxy } from "../proxy";

const gate = vi.hoisted(() => ({ isPublicBoardOpen: vi.fn(), isPublicNodeVisible: vi.fn() }));
vi.mock("@/lib/public-status/gate", () => gate);

vi.mock("@/lib/auth/session", () => ({
  getSessionCookieName: () =>
    process.env.AUTH_SESSION_COOKIE_NAME?.trim() ||
    `${process.env.APP_SLUG || "vcontrolhub"}_session`,
}));

/** Paths other than "/" (anonymous) and /status/nodes/* are answered synchronously. */
function syncProxy(request: NextRequest): NextResponse {
  const response = proxy(request);
  if (response instanceof Promise) throw new Error("expected a synchronous proxy answer");
  return response;
}

function makeRequest(pathname: string, init: NextRequestInit = {}) {
  return new NextRequest(new URL(pathname, "https://example.test"), init);
}

function sessionCookie(value = "header.payload.signature-value") {
  const name =
    process.env.AUTH_SESSION_COOKIE_NAME?.trim() ||
    `${process.env.APP_SLUG || "vcontrolhub"}_session`;
  return `${name}=${value}`;
}

describe("proxy auth guard", () => {
  it("allows the Scalar CDN required by the API docs page", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");

    const response = syncProxy(
      makeRequest("/api-docs", {
        headers: { cookie: sessionCookie() },
      }),
    );

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toMatch(/script-src 'self' 'nonce-[^']+' 'strict-dynamic' https:\/\/cdn\.jsdelivr\.net https:\/\/static\.cloudflareinsights\.com/);
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).not.toContain("'unsafe-eval'");
    expect(csp).not.toContain("script-src 'self' 'unsafe-inline'");
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(csp).toContain("font-src 'self' data: https://fonts.scalar.com");
    expect(csp).toContain("media-src 'self' blob:");
    expect(csp).toContain("frame-src 'self'");
    expect(csp).not.toContain("view.officeapps.live.com");
    expect(csp).toContain("frame-ancestors 'self'");

    if (originalNodeEnv === undefined) vi.unstubAllEnvs();
    else vi.stubEnv("NODE_ENV", originalNodeEnv);
  });

  it("redirects anonymous page requests to login with the original path", () => {
    const response = syncProxy(makeRequest("/servers"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.test/login?next=%2Fservers",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("uses the same app slug session cookie name as login and server components", () => {
    vi.stubEnv("APP_SLUG", "my-console");
    vi.stubEnv("AUTH_SESSION_COOKIE_NAME", "");

    const response = syncProxy(
      makeRequest("/servers", {
        headers: {
          cookie: "my-console_session=header.payload.signature-value",
        },
      }),
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();

    vi.unstubAllEnvs();
  });

  it("returns 401 for anonymous protected API requests", async () => {
    const response = syncProxy(makeRequest("/api/servers/monitor"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not logged in or session expired",
    });
  });

  it("rejects form requests without a valid declared content length", async () => {
    for (const contentLength of [undefined, "invalid"]) {
      const headers: Record<string, string> = {
        "content-type": "multipart/form-data; boundary=test",
      };
      if (contentLength) headers["content-length"] = contentLength;
      const response = syncProxy(makeRequest("/api/login", {
        method: "POST",
        headers,
      }));

      expect(response.status).toBe(411);
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      await expect(response.json()).resolves.toEqual({ error: "LENGTH_REQUIRED" });
    }
  });

  it("allows form requests with a valid declared content length", () => {
    const response = syncProxy(makeRequest("/api/login", {
      method: "POST",
      headers: {
        "content-type": "application/x-www-form-urlencoded",
        "content-length": "28",
      },
    }));

    expect(response.status).toBe(200);
  });

  it("allows public login requests through with forwarded auth-page marker and security headers", () => {
    const response = syncProxy(makeRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("x-vcontrolhub-public-auth-page")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "x-vcontrolhub-public-auth-page",
    );
  });

  it("lets anonymous browsers reach app icon assets", () => {
    for (const pathname of ["/favicon.ico", "/icon.png", "/apple-icon.png"]) {
      const response = syncProxy(makeRequest(pathname));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("lets anonymous browsers reach image file GET routes so public image links can render", () => {
    const response = syncProxy(makeRequest("/api/images/img_1/file"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("delegates WebDAV auth to its Basic/Bearer route without opening lookalike paths", () => {
    expect(syncProxy(makeRequest("/api/webdav/node-1")).status).toBe(200);
    expect(syncProxy(makeRequest("/api/webdav-admin/node-1")).status).toBe(401);
  });

  it("lets anonymous browsers reach public share pages and share download APIs", () => {
    for (const pathname of ["/share/public-token", "/api/share/public-token"]) {
      const response = syncProxy(makeRequest(pathname));

      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    }
  });

  it("lets anonymous visitors reach the status board, node pages and its read API without lookalikes", async () => {
    gate.isPublicNodeVisible.mockResolvedValue(true);
    for (const pathname of ["/status", "/status/nodes/abcdefghijkl", "/api/status/board", "/api/status/nodes/abcdefghijkl/history"]) {
      const response = await proxy(makeRequest(pathname));
      expect(response.status).toBe(200);
      expect(response.headers.get("location")).toBeNull();
    }
    // Neither the admin page nor the admin API is public.
    expect((await proxy(makeRequest("/public-status"))).status).toBe(307);
    expect((await proxy(makeRequest("/api/admin/public-status/site"))).status).toBe(401);
    expect((await proxy(makeRequest("/statusx"))).status).toBe(307);
    expect((await proxy(makeRequest("/api/statusx"))).status).toBe(401);
  });

  it("sends anonymous visitors of / to the open board or to sign-in with a real redirect", async () => {
    gate.isPublicBoardOpen.mockResolvedValueOnce(true);
    let response = await proxy(makeRequest("/"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/status");
    gate.isPublicBoardOpen.mockResolvedValueOnce(false);
    response = await proxy(makeRequest("/"));
    expect(response.headers.get("location")).toBe("https://example.test/login?next=%2F");
    // Signed-in users keep the dashboard; a database failure leaves the decision to the page.
    gate.isPublicBoardOpen.mockClear();
    expect((await proxy(makeRequest("/", { headers: { cookie: sessionCookie() } }))).status).toBe(200);
    expect(gate.isPublicBoardOpen).not.toHaveBeenCalled();
    gate.isPublicBoardOpen.mockRejectedValueOnce(new Error("db down"));
    expect((await proxy(makeRequest("/"))).status).toBe(200);
  });

  it("answers a hidden or unknown public node page with a real 404 rewrite", async () => {
    gate.isPublicNodeVisible.mockResolvedValueOnce(false);
    const hidden = await proxy(makeRequest("/status/nodes/abcdefghijkl"));
    expect(hidden.headers.get("x-middleware-rewrite")).toBe(`https://example.test${PUBLIC_NODE_NOT_FOUND_PATH}`);
    gate.isPublicNodeVisible.mockResolvedValueOnce(true);
    const visible = await proxy(makeRequest("/status/nodes/abcdefghijkl"));
    expect(visible.headers.get("x-middleware-rewrite")).toBeNull();
    // Administrator previews are left to the page (it checks the role).
    gate.isPublicNodeVisible.mockClear();
    await proxy(makeRequest("/status/nodes/abcdefghijkl?preview=1", { headers: { cookie: sessionCookie() } }));
    expect(gate.isPublicNodeVisible).not.toHaveBeenCalled();
  });

  it("still requires CSRF for state-changing admin board requests", () => {
    const response = syncProxy(makeRequest("/api/admin/public-status/site", { method: "PUT", headers: { cookie: sessionCookie() } }));
    expect(response.status).toBe(403);
  });

  it("lets anonymous ITSM inbound webhooks through so HMAC can be verified in-route", () => {
    const response = syncProxy(
      makeRequest("/api/itsm/inbound/conn_1", {
        method: "POST",
        headers: { "content-type": "application/json" },
      }),
    );

    // Must not be blocked by session middleware (route enforces signature).
    expect(response.status).toBe(200);
    expect(response.headers.get("location")).toBeNull();
  });

  it("keeps state-changing image API routes protected by auth and CSRF", async () => {
    const response = syncProxy(
      makeRequest("/api/images/img_1/file", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "Not logged in or session expired",
    });
  });

  it("requires CSRF for cookie-authenticated image writes", () => {
    const response = syncProxy(
      makeRequest("/api/images/upload", {
        method: "POST",
        headers: { cookie: sessionCookie() },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("lets bearer clients reach token-aware image writes for route-level auth", () => {
    const response = syncProxy(
      makeRequest("/api/images/upload", {
        method: "POST",
        headers: { authorization: "Bearer whr_test" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("lets bearer clients reach protected read APIs for route-level scope checks", () => {
    const response = syncProxy(
      makeRequest("/api/servers/monitor", {
        headers: { authorization: "Bearer whr_test" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("lets WebDAV bearer writes reach its dedicated authenticator", () => {
    const response = syncProxy(
      makeRequest("/api/webdav/node-1/file.txt", {
        method: "PUT",
        headers: { authorization: "Bearer whr_test" },
      }),
    );

    expect(response.status).toBe(200);
  });

  it("does not let arbitrary bearer headers bypass protected API auth", () => {
    const response = syncProxy(
      makeRequest("/api/backups/record_1/void", {
        method: "POST",
        headers: { authorization: "Bearer invalid" },
      }),
    );

    expect(response.status).toBe(401);
  });

  it("still requires CSRF for non-token-aware routes with a session cookie", () => {
    const response = syncProxy(
      makeRequest("/api/backups/record_1/void", {
        method: "POST",
        headers: {
          authorization: "Bearer invalid",
          cookie: sessionCookie(),
        },
      }),
    );

    expect(response.status).toBe(403);
  });

  it("requires CSRF token on /api/auth/signout (no longer exempt)", async () => {
    // Authenticated request without csrf_token must be rejected — closes
    // a real CSRF surface where a third-party origin could log out the user
    // via <form action="/api/auth/signout" method="POST">.
    const response = syncProxy(
      makeRequest("/api/auth/signout", {
        method: "POST",
        headers: { cookie: sessionCookie() },
      }),
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toEqual({
      error: "CSRF token validation failed",
    });
  });

  it("accepts /api/auth/signout when csrf cookie and header match", async () => {
    const response = syncProxy(
      makeRequest("/api/auth/signout", {
        method: "POST",
        headers: {
          cookie: `${sessionCookie()}; csrf_token=tkn`,
          "x-csrf-token": "tkn",
        },
      }),
    );
    expect(response.status).toBe(200);
  });

  it("keeps PWA resources public", () => {
    for (const pathname of [
      "/sw.js",
      "/manifest.webmanifest",
      "/offline",
      "/icon-192x192.png",
    ]) {
      const response = syncProxy(makeRequest(pathname));
      expect(response.status, pathname).toBe(200);
      expect(response.headers.get("location"), pathname).toBeNull();
    }
  });
});
