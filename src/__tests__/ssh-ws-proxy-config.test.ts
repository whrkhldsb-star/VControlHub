import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

import { loadSshWsRuntimeEnv, resolveSshWsListenConfig } from "../ssh-ws-proxy";

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

  it("does not retain the legacy raw secret query-parameter check", async () => {
    const source = await readFile(path.resolve(__dirname, "../ssh-ws-proxy.ts"), "utf8");
    expect(source).toContain('url.searchParams.get("handshake")');
    expect(source).toContain("verifySshWsHandshakeToken");
    expect(source).not.toContain('url.searchParams.get("secret")');
  });

  it("loads SSH runtime env files when the process starts with a minimal environment", () => {
    const previousSecret = process.env.SSH_WS_SECRET;
    const previousOrigins = process.env.SSH_WS_ALLOWED_ORIGINS;

    delete process.env.SSH_WS_SECRET;
    delete process.env.SSH_WS_ALLOWED_ORIGINS;

    try {
      loadSshWsRuntimeEnv(path.resolve(__dirname, "../.."));

      expect(process.env.SSH_WS_SECRET).toBeTruthy();
      expect(process.env.SSH_WS_ALLOWED_ORIGINS).toContain("whrkhldsb.qzz.io");
    } finally {
      if (previousSecret === undefined) delete process.env.SSH_WS_SECRET;
      else process.env.SSH_WS_SECRET = previousSecret;
      if (previousOrigins === undefined) delete process.env.SSH_WS_ALLOWED_ORIGINS;
      else process.env.SSH_WS_ALLOWED_ORIGINS = previousOrigins;
    }
  });
});
