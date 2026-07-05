import { describe, expect, it } from "vitest";
import type { ConnectConfig } from "ssh2";

import { createSshConfigForTest } from "../client";

describe("SSH client host key verification", () => {
  it("installs a sha256 hostVerifier when a host key fingerprint is configured", () => {
    const config = createSshConfigForTest({
      host: "203.0.113.10",
      port: 22,
      username: "root",
      privateKey: "PRIVATE KEY",
      hostKeySha256: "SHA256:abcdef",
    }) as ConnectConfig;

    expect(config.hostHash).toBe("sha256");
    const verifier = config.hostVerifier as unknown as (hash: string) => boolean;
    expect(verifier("abcdef")).toBe(true);
    expect(verifier("different")).toBe(false);
  });
});
