import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

const spawnMock = vi.hoisted(() => vi.fn());
vi.mock("../command-runner", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../command-runner")>()),
  spawnAria2Detached: spawnMock,
}));

import {
  ARIA2_MANAGED_DAEMON_UNREACHABLE,
  buildAria2Config,
  buildAria2LaunchConfig,
  buildAria2SpawnArgs,
  ensureAria2Daemon,
  getAria2RuntimeConfig,
  getPublicAria2Error,
  isAria2ManagedExternally,
} from "../service";

afterEach(() => {
  delete process.env.ARIA2_MANAGED_EXTERNALLY;
  delete process.env.ARIA2_RPC_PORT;
  delete process.env.ARIA2_RPC_SECRET;
  spawnMock.mockReset();
});

describe("aria2 runtime config", () => {
  it("defaults to portable app-scoped paths and loopback RPC", () => {
    const config = getAria2RuntimeConfig({ APP_DIR: "/opt/whrkhldsb" });

    expect(config.rpcHost).toBe("127.0.0.1");
    expect(config.rpcPort).toBe(6800);
    expect(config.rpcDir).toBe(path.join("/opt/whrkhldsb", "tmp", "aria2"));
    expect(config.rpcConf).toBe(path.join("/opt/whrkhldsb", "tmp", "aria2", "aria2.conf"));
    expect(config.rpcSession).toBe(path.join("/opt/whrkhldsb", "tmp", "aria2", "aria2.session"));
  });

  it("honors explicit RPC host, port, secret, and directory overrides", () => {
    const config = getAria2RuntimeConfig({
      ARIA2_RPC_HOST: "10.0.0.2",
      ARIA2_RPC_PORT: "16800",
      ARIA2_RPC_SECRET: "custom-token",
      ARIA2_RPC_DIR: "/srv/aria2-state",
    });

    expect(config.rpcHost).toBe("10.0.0.2");
    expect(config.rpcPort).toBe(16800);
    expect(config.rpcSecret).toBe("custom-token");
    expect(config.rpcDir).toBe("/srv/aria2-state");
  });

  it("rejects invalid ports and placeholder production secrets", () => {
    expect(() => getAria2RuntimeConfig({ ARIA2_RPC_PORT: "bad" })).toThrow("ARIA2_RPC_PORT must be a valid TCP port");
    expect(() => getAria2RuntimeConfig({ NODE_ENV: "production" })).toThrow("ARIA2_RPC_SECRET is required in production");
    expect(() =>
      getAria2RuntimeConfig({ NODE_ENV: "production", ARIA2_RPC_SECRET: "whrkhldsb_default_token" }),
    ).toThrow("ARIA2_RPC_SECRET must not use the default token in production");
  });

  it("builds an aria2 config from runtime settings without hardcoded /tmp state or persisted RPC secrets", () => {
    const config = getAria2RuntimeConfig({
      APP_DIR: "/opt/whrkhldsb",
      ARIA2_RPC_SECRET: "custom-token",
      ARIA2_RPC_PORT: "16800",
    });
    const text = buildAria2Config(config);

    expect(text).toContain("rpc-listen-port=16800");
    expect(text).not.toContain("custom-token");
    expect(text).not.toContain("rpc-secret=");
    expect(text).toContain(`dir=${path.join("/opt/whrkhldsb", "tmp", "aria2")}`);
    expect(text).not.toContain("/tmp/whrkhldsb-aria2");
    expect(text).not.toContain("\\tmp\\whrkhldsb-aria2");
    const launchConfig = buildAria2LaunchConfig(config);
    expect(launchConfig).toContain("rpc-secret=custom-token");
    expect(buildAria2SpawnArgs("/opt/whrkhldsb/tmp/aria2/.aria2.launch.conf")).toEqual([
      "--conf-path=/opt/whrkhldsb/tmp/aria2/.aria2.launch.conf",
    ]);
    expect(buildAria2SpawnArgs("/opt/whrkhldsb/tmp/aria2/.aria2.launch.conf").join(" ")).not.toContain("custom-token");
  });

  it("surfaces missing aria2c as an actionable dependency error", () => {
    expect(getPublicAria2Error(Object.assign(new Error("spawn aria2c ENOENT"), { code: "ENOENT" }))).toBe(
      "未安装 aria2c，无法进行磁力/BT 中继下载。请在服务器上安装 aria2。",
    );
    expect(
      getPublicAria2Error(Object.assign(new Error("spawn aria2c ENOENT"), { code: "ENOENT" }), "en"),
    ).toBe(
      "aria2c is not installed; cannot perform magnet/BT relay download. Please install aria2 on the server.",
    );
  });
});

describe("externally managed aria2 daemon", () => {
  it("recognises the flag in its accepted spellings", () => {
    expect(isAria2ManagedExternally({})).toBe(false);
    expect(isAria2ManagedExternally({ ARIA2_MANAGED_EXTERNALLY: "0" })).toBe(false);
    expect(isAria2ManagedExternally({ ARIA2_MANAGED_EXTERNALLY: "1" })).toBe(true);
    expect(isAria2ManagedExternally({ ARIA2_MANAGED_EXTERNALLY: " true " })).toBe(true);
  });

  it("never spawns its own daemon when the host runs the confined unit; the error names the service", async () => {
    process.env.ARIA2_MANAGED_EXTERNALLY = "1";
    // Nothing listens here, so the RPC probe fails fast and the old code path would spawn.
    process.env.ARIA2_RPC_PORT = "1";
    process.env.ARIA2_RPC_SECRET = "unit-test-secret";
    await expect(ensureAria2Daemon()).rejects.toThrow(ARIA2_MANAGED_DAEMON_UNREACHABLE);
    expect(spawnMock).not.toHaveBeenCalled();
    expect(getPublicAria2Error(new Error(ARIA2_MANAGED_DAEMON_UNREACHABLE), "en")).toContain("systemctl start <prefix>-aria2.service");
  });
});
