import { describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

type NextRequestInit = ConstructorParameters<typeof NextRequest>[1];

import { proxy } from "../proxy";

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
    expect(csp).toContain("script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net");
    expect(csp).toContain("style-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net");

    if (originalNodeEnv === undefined) vi.unstubAllEnvs();
    else vi.stubEnv("NODE_ENV", originalNodeEnv);
  });

  it("redirects anonymous page requests to login with the original path", () => {
    const response = proxy(makeRequest("/servers"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://example.test/login?next=%2Fservers");
    expect(response.headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
  });

  it("returns 401 for anonymous protected API requests", async () => {
    const response = proxy(makeRequest("/api/servers/monitor"));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "未登录或会话已过期" });
  });

  it("allows public login requests through with security headers", () => {
    const response = proxy(makeRequest("/login"));

    expect(response.status).toBe(200);
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
