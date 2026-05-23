import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/require-api-permission", () => ({
  requireApiPermission: vi.fn(),
}));

vi.mock("@/lib/auth/ssh-ws-token", () => ({
  createSshWsHandshakeToken: vi.fn(() => "short-lived-token"),
}));

import { requireApiPermission } from "@/lib/auth/require-api-permission";
import { createSshWsHandshakeToken } from "@/lib/auth/ssh-ws-token";
import { POST } from "../route";

describe("POST /api/auth/ws-token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.SSH_WS_SECRET = "unit-test-ssh-ws-key";
  });

  it("returns a short-lived token and never exposes SSH_WS_SECRET", async () => {
    vi.mocked(requireApiPermission).mockResolvedValue({
      session: {
        userId: "user-1",
        username: "alice",
        roles: ["admin"],
        mustChangePassword: false,
      },
    });

    const response = await POST(
      new NextRequest("https://console.example.test/api/auth/ws-token", {
        method: "POST",
        body: JSON.stringify({ serverId: "server-1", sessionToken: "session-token" }),
        headers: { "content-type": "application/json", origin: "https://console.example.test" },
      }),
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ token: "short-lived-token", expiresIn: 60 });
    expect(JSON.stringify(body)).not.toContain("unit-test-ssh-ws-key");
    expect(createSshWsHandshakeToken).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: "user-1",
        serverId: "server-1",
        origin: "https://console.example.test",
        sessionId: "session-token",
        secret: "unit-test-ssh-ws-key",
      }),
    );
  });

  it("requires a concrete serverId and sessionToken", async () => {
    vi.mocked(requireApiPermission).mockResolvedValue({
      session: {
        userId: "user-1",
        username: "alice",
        roles: ["admin"],
        mustChangePassword: false,
      },
    });

    const response = await POST(
      new NextRequest("https://console.example.test/api/auth/ws-token", {
        method: "POST",
        body: JSON.stringify({ serverId: "", sessionToken: "" }),
        headers: { "content-type": "application/json", origin: "https://console.example.test" },
      }),
    );

    expect(response.status).toBe(400);
    expect(createSshWsHandshakeToken).not.toHaveBeenCalled();
  });
});
