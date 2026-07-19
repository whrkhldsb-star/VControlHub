import { describe, expect, it } from "vitest";

import {
  buildAria2Config,
  buildAria2LaunchConfig,
  buildAria2SpawnArgs,
  getAria2RuntimeConfig,
  getPublicAria2Error,
} from "../service";

describe("aria2 runtime config", () => {
  it("defaults to portable app-scoped paths and loopback RPC", () => {
    const config = getAria2RuntimeConfig({ APP_DIR: "/opt/whrkhldsb" });

    expect(config.rpcHost).toBe("127.0.0.1");
    expect(config.rpcPort).toBe(6800);
    expect(config.rpcDir).toBe("/opt/whrkhldsb/tmp/aria2");
    expect(config.rpcConf).toBe("/opt/whrkhldsb/tmp/aria2/aria2.conf");
    expect(config.rpcSession).toBe("/opt/whrkhldsb/tmp/aria2/aria2.session");
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
    expect(text).toContain("dir=/opt/whrkhldsb/tmp/aria2");
    expect(text).not.toContain("/tmp/whrkhldsb-aria2");
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
