import { describe, expect, it } from "vitest";

import {
  createSshWsHandshakeToken,
  verifySshWsHandshakeToken,
} from "../lib/auth/ssh-ws-token";

describe("SSH WebSocket handshake tokens", () => {
  it("creates short-lived tokens without exposing the global proxy secret", () => {
    const token = createSshWsHandshakeToken({
      userId: "user-1",
      serverId: "server-1",
      origin: "https://console.example.test",
      sessionId: "session-token",
      secret: "server-side-secret",
      now: 1_700_000_000_000,
      ttlMs: 60_000,
    });

    expect(token).not.toContain("server-side-secret");

    const payload = verifySshWsHandshakeToken(token, {
      serverId: "server-1",
      origin: "https://console.example.test",
      sessionId: "session-token",
      secret: "server-side-secret",
      now: 1_700_000_030_000,
    });

    expect(payload).toMatchObject({ userId: "user-1", serverId: "server-1" });
  });

  it("rejects expired, wrong-origin, wrong-server, and wrong-session tokens", () => {
    const token = createSshWsHandshakeToken({
      userId: "user-1",
      serverId: "server-1",
      origin: "https://console.example.test",
      sessionId: "session-token",
      secret: "server-side-secret",
      now: 1_700_000_000_000,
      ttlMs: 60_000,
    });

    expect(
      verifySshWsHandshakeToken(token, {
        serverId: "server-1",
        origin: "https://console.example.test",
        sessionId: "session-token",
        secret: "server-side-secret",
        now: 1_700_000_061_000,
      }),
    ).toBeNull();
    expect(
      verifySshWsHandshakeToken(token, {
        serverId: "server-1",
        origin: "https://evil.example.test",
        sessionId: "session-token",
        secret: "server-side-secret",
        now: 1_700_000_030_000,
      }),
    ).toBeNull();
    expect(
      verifySshWsHandshakeToken(token, {
        serverId: "server-2",
        origin: "https://console.example.test",
        sessionId: "session-token",
        secret: "server-side-secret",
        now: 1_700_000_030_000,
      }),
    ).toBeNull();
    expect(
      verifySshWsHandshakeToken(token, {
        serverId: "server-1",
        origin: "https://console.example.test",
        sessionId: "other-session-token",
        secret: "server-side-secret",
        now: 1_700_000_030_000,
      }),
    ).toBeNull();
    expect(
      verifySshWsHandshakeToken(`${token}.extra`, {
        serverId: "server-1",
        origin: "https://console.example.test",
        sessionId: "session-token",
        secret: "server-side-secret",
        now: 1_700_000_030_000,
      }),
    ).toBeNull();
  });
});
