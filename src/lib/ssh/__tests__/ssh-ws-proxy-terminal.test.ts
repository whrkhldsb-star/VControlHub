import { describe, expect, it, vi } from "vitest";

// The proxy module wires up an HTTP server + WS server at import time. It
// does not listen under NODE_ENV=test, but its runtime-settings bootstrap
// would hit the database — stub that plus the prisma/RDP imports the module
// graph pulls in so the import stays hermetic.
vi.mock("@/lib/db", () => ({
  prisma: {
    $disconnect: vi.fn(async () => undefined),
    server: { findFirst: vi.fn(async () => null) },
  },
}));
vi.mock("@/lib/runtime-settings/service", () => ({
  getSshTerminalRuntimeConfig: vi.fn(async () => ({
    wsHeartbeatIntervalMs: 30_000,
    sshKeepaliveIntervalMs: 15_000,
    sshKeepaliveCountMax: 3,
  })),
}));
vi.mock("@/lib/rdp/ws", () => ({
  setupRdpWebSocket: vi.fn(() => () => undefined),
}));

import { buildTerminalSshConfig, describeTerminalSshError } from "../../../ssh-ws-proxy";
import { createHash } from "node:crypto";

const RUNTIME = { sshKeepaliveIntervalMs: 15_000, sshKeepaliveCountMax: 3 };

const CONN = {
  host: "203.0.113.10",
  port: 22,
  username: "root",
  connectionType: "PASSWORD" as const,
  hostKeySha256: null as string | null,
  privateKey: undefined,
  passphrase: undefined,
  password: "secret",
};

/** Standard unpadded-base64 SHA256 fingerprint of a fake host key. */
function fingerprintFor(seed: string) {
  const hex = createHash("sha256").update(seed).digest("hex");
  const standard = Buffer.from(hex, "hex").toString("base64").replace(/=+$/, "");
  return { hex, standard };
}

describe("SSH terminal channel host-key enforcement", () => {
  it("rejects the host key during the handshake when no fingerprint is pinned (fail-closed)", () => {
    const config = buildTerminalSshConfig({ ...CONN, hostKeySha256: null }, RUNTIME);
    // Without enforceHostKeyPin the unpinned verifier would accept (TOFU
    // compat) — a false verdict here means the terminal is not fail-closed.
    expect(config.hostHash).toBe("sha256");
    expect(typeof config.hostVerifier).toBe("function");
    const verifier = config.hostVerifier as (key: string) => boolean;
    const { hex } = fingerprintFor("unpinned-host");
    expect(verifier(hex)).toBe(false);
  });

  it("accepts the handshake when the presented key matches the pinned fingerprint", () => {
    const { hex, standard } = fingerprintFor("pinned-host");
    const config = buildTerminalSshConfig(
      { ...CONN, hostKeySha256: `SHA256:${standard}` },
      RUNTIME,
    );
    const verifier = config.hostVerifier as (key: string) => boolean;
    expect(verifier(hex)).toBe(true);
  });

  it("rejects a pinned server that presents a different key", () => {
    const pinned = fingerprintFor("pinned-host");
    const presented = fingerprintFor("attacker-host");
    const config = buildTerminalSshConfig(
      { ...CONN, hostKeySha256: `SHA256:${pinned.standard}` },
      RUNTIME,
    );
    const verifier = config.hostVerifier as (key: string) => boolean;
    expect(verifier(presented.hex)).toBe(false);
  });

  it("carries the terminal keepalive settings onto the connect config", () => {
    const config = buildTerminalSshConfig({ ...CONN, hostKeySha256: null }, RUNTIME);
    expect(config.keepaliveInterval).toBe(RUNTIME.sshKeepaliveIntervalMs);
    expect(config.keepaliveCountMax).toBe(RUNTIME.sshKeepaliveCountMax);
  });

  it("explains host-key verification failures with pin-first guidance", () => {
    const described = describeTerminalSshError(
      new Error("(Handshake failed) Host key verification failed"),
    );
    expect(described).not.toContain("Handshake failed");
    expect(described).toContain("主机密钥");
  });

  it("keeps the raw ssh2 detail for unrelated transport errors", () => {
    expect(describeTerminalSshError(new Error("ECONNREFUSED"))).toBe(
      "SSH connection error: ECONNREFUSED",
    );
  });
});
