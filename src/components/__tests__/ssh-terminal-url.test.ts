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
});
