import { describe, expect, it } from "vitest";

import { buildSshWebSocketUrl } from "../ssh-terminal-url";

describe("buildSshWebSocketUrl", () => {
  it("uses a short-lived handshake token instead of exposing a raw secret query parameter", () => {
    const url = buildSshWebSocketUrl({
      pageProtocol: "https:",
      host: "console.example.test",
      serverId: "server-1",
      sessionToken: "session-token",
      handshakeToken: "short-lived-token",
    });

    expect(url).toBe(
      "wss://console.example.test/ssh?serverId=server-1&token=session-token&handshake=short-lived-token",
    );
    expect(url).not.toContain("secret=");
  });
});
