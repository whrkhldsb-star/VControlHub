import { describe, expect, it } from "vitest";

import { buildSshWebSocketUrl } from "../ssh-terminal-url";

describe("buildSshWebSocketUrl", () => {
  it("uses a short-lived handshake token and never puts the session JWT in the query string", () => {
    const url = buildSshWebSocketUrl({
      pageProtocol: "https:",
      host: "console.example.test",
      serverId: "server-1",
      handshakeToken: "short-lived-token",
    });

    expect(url).toBe(
      "wss://console.example.test/ssh?serverId=server-1&handshake=short-lived-token",
    );
    expect(url).not.toContain("token=");
    expect(url).not.toContain("secret=");
    expect(url).not.toContain("session-token");
  });

  it("asks for a kept shell, and names the one to resume, only when the terminal opted in", () => {
    const base = { pageProtocol: "http:", host: "127.0.0.1:3000", serverId: "server-1", handshakeToken: "tok" };
    expect(buildSshWebSocketUrl({ ...base, keepAlive: true })).toBe("ws://127.0.0.1:3000/ssh?serverId=server-1&handshake=tok&keepAlive=1");
    expect(buildSshWebSocketUrl({ ...base, keepAlive: true, resumeId: "abc" })).toBe("ws://127.0.0.1:3000/ssh?serverId=server-1&handshake=tok&keepAlive=1&resume=abc");
    expect(buildSshWebSocketUrl({ ...base, keepAlive: false, resumeId: "abc" })).toBe("ws://127.0.0.1:3000/ssh?serverId=server-1&handshake=tok");
  });
});
