import { describe, expect, it } from "vitest";

import { resolveSshWsListenConfig } from "../ssh-ws-proxy";

describe("resolveSshWsListenConfig", () => {
  it("defaults to loopback host and port 3001", () => {
    expect(resolveSshWsListenConfig({})).toEqual({ host: "127.0.0.1", port: 3001 });
  });

  it("honors portable host and port environment overrides", () => {
    expect(resolveSshWsListenConfig({ SSH_WS_HOST: "0.0.0.0", SSH_WS_PORT: "3101" })).toEqual({
      host: "0.0.0.0",
      port: 3101,
    });
  });

  it("rejects invalid port values clearly", () => {
    expect(() => resolveSshWsListenConfig({ SSH_WS_PORT: "not-a-port" })).toThrow("SSH_WS_PORT must be a valid TCP port");
    expect(() => resolveSshWsListenConfig({ SSH_WS_PORT: "70000" })).toThrow("SSH_WS_PORT must be a valid TCP port");
  });
});
