import { describe, expect, it } from "vitest";

import { shouldBypassAuth, verifySessionToken, createSessionToken } from "@/lib/auth/session";

describe("session auth helpers", () => {
  it("allows anonymous access only for login and static asset paths", () => {
    expect(shouldBypassAuth("/login")).toBe(true);
    expect(shouldBypassAuth("/_next/static/chunk.js")).toBe(true);
    expect(shouldBypassAuth("/favicon.ico")).toBe(true);
    expect(shouldBypassAuth("/servers")).toBe(false);
  });

  it("round-trips a signed session token", async () => {
    const token = await createSessionToken({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: true,
    });

    await expect(verifySessionToken(token)).resolves.toMatchObject({
      userId: "u_1",
      username: "admin",
      roles: ["admin"],
      mustChangePassword: true,
    });
  });
});
