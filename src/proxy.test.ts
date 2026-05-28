import { describe, expect, it, vi } from "vitest";
import type { NextRequest } from "next/server";

vi.mock("@/lib/auth/session", () => ({ getSessionCookieName: () => "vcontrolhub_session" }));

const { proxy } = await import("./proxy");

function makeRequest(pathname: string, init: { method?: string; headers?: Record<string, string>; cookies?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  const request = {
    method: init.method ?? "GET",
    headers,
    nextUrl: new URL(`https://example.com${pathname}`),
    cookies: {
      get(name: string) {
        const value = init.cookies?.[name];
        return value ? { name, value } : undefined;
      },
    },
  };
  return request as unknown as NextRequest;
}

describe("proxy auth and CSRF boundaries", () => {
  it("requires CSRF for cookie-authenticated image writes", () => {
    const response = proxy(makeRequest("/api/images/upload", {
      method: "POST",
      cookies: { vcontrolhub_session: "payload.signature.with.length" },
    }));

    expect(response.status).toBe(403);
  });

  it("lets bearer-token API clients reach image write routes for route-level auth", () => {
    const response = proxy(makeRequest("/api/images/upload", {
      method: "POST",
      headers: { authorization: "Bearer whr_test" },
    }));

    expect(response.status).toBe(200);
  });
});
