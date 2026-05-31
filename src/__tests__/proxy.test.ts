import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

import { proxy } from "../proxy";

vi.mock("@/lib/auth/session", () => ({
  getSessionCookieName: () =>
    process.env.AUTH_SESSION_COOKIE_NAME?.trim() ||
    `${process.env.APP_SLUG || "whrkhldsb"}_session`,
}));

function makeRequest(pathname: string, init: NextRequestInit = {}) {
  return new NextRequest(new URL(pathname, "https://example.test"), init);
}

describe("proxy auth guard", () => {
  it("allows the Scalar CDN required by the API docs page", () => {
    const originalNodeEnv = process.env.NODE_ENV;
    vi.stubEnv("NODE_ENV", "production");

    const response = proxy(
      makeRequest("/api-docs", {
        headers: { cookie: "whrkhldsb_session=header.payload.signature-value" },
      }),
    );

    const csp = response.headers.get("Content-Security-Policy");
    expect(csp).toContain(
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://static.cloudflareinsights.com",
    );
    expect(csp).toContain(
      "style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net",
    );
    expect(csp).toContain("font-src 'self' data: https://fonts.scalar.com");

    if (originalNodeEnv === undefined) vi.unstubAllEnvs();
    else vi.stubEnv("NODE_ENV", originalNodeEnv);
  });

  it("redirects anonymous page requests to login with the original path", () => {
    const response = proxy(makeRequest("/servers"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://example.test/login?next=%2Fservers",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("uses the same app slug session cookie name as login and server components", () => {
    vi.stubEnv("APP_SLUG", "my-console");
    vi.stubEnv("AUTH_SESSION_COOKIE_NAME", "");

    const response = proxy(
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
    const response = proxy(makeRequest("/api/servers/monitor"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "未登录或会话已过期",
    });
  });

  it("allows public login requests through with forwarded auth-page marker and security headers", () => {
    const response = proxy(makeRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("x-vcontrolhub-public-auth-page")).toBeNull();
    expect(response.headers.get("x-middleware-override-headers")).toContain(
      "x-vcontrolhub-public-auth-page",
    );
  });

  it("lets anonymous browsers reach image file GET routes so public image links can render", () => {
    const response = proxy(makeRequest("/api/images/img_1/file"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("keeps state-changing image API routes protected by auth and CSRF", async () => {
    const response = proxy(
      makeRequest("/api/images/img_1/file", { method: "POST" }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({
      error: "未登录或会话已过期",
    });
  });
});
