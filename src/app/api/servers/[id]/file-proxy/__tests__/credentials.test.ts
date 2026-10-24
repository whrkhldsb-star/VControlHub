import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ configInputs: [] as Array<Record<string, unknown>>, server: vi.fn() }));

vi.mock("ssh2", () => ({
  Client: class {
    private handlers: Record<string, (...args: unknown[]) => void> = {};
    on(event: string, handler: (...args: unknown[]) => void) { this.handlers[event] = handler; return this; }
    connect() { this.handlers.ready?.(); }
    exec(_command: string, _options: unknown, callback: (error: Error | null, stream: unknown) => void) {
      const handlers: Record<string, (...args: unknown[]) => void> = {};
      const stream = {
        on(event: string, handler: (...args: unknown[]) => void) { handlers[event] = handler; return stream; },
        stderr: { on() { return stream.stderr; } },
      };
      callback(null, stream);
      queueMicrotask(() => { handlers.data?.(Buffer.from("123\n")); handlers.close?.(0); });
    }
    end() {}
  },
}));
vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: vi.fn(async () => ({ userId: "u1", username: "admin", roles: ["admin"] })),
  isSessionPayload: (value: unknown) => Boolean(value && typeof value === "object" && "userId" in value),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => true }));
vi.mock("@/lib/db", () => ({
  prisma: {
    server: { findUnique: mocks.server },
    serverFileProxy: {
      findUnique: vi.fn(async () => ({ id: "p1", pid: 123, status: "running", port: 31889, accessToken: "t", expiresAt: new Date(Date.now() + 60_000) })),
      update: vi.fn(),
    },
  },
}));
// The stored key is passphrase-protected: decrypting the key alone leaves it
// encrypted; the stored-key helper unlocks it with its passphrase.
vi.mock("@/lib/ssh/ssh-key-crypto", () => ({
  decryptServerPassword: (value: string) => `plain:${value}`,
  decryptSshPrivateKey: () => "-----BEGIN ENCRYPTED PRIVATE KEY-----",
  decryptStoredSshKey: (key: { privateKey?: string | null; passphrase?: string | null } | null) =>
    key?.privateKey ? { privateKey: key.passphrase ? "UNLOCKED-KEY" : "PLAIN-KEY" } : null,
}));
vi.mock("@/lib/ssh/client", () => ({
  createVerifiedSshConfig: vi.fn((input: Record<string, unknown>) => { mocks.configInputs.push(input); return {}; }),
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: vi.fn(async () => async () => undefined) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));

import { GET } from "../route";

const params = { params: Promise.resolve({ id: "srv_1" }) };
const baseServer = { id: "srv_1", host: "203.0.113.5", port: 22, username: "root", hostKeySha256: "SHA256:x", publicUrl: "https://n.example.com", teamId: null };

describe("file proxy SSH credentials", () => {
  beforeEach(() => {
    mocks.configInputs.length = 0;
  });

  it("unlocks a passphrase-protected key instead of sending it encrypted", async () => {
    mocks.server.mockResolvedValue({ ...baseServer, connectionType: "SSH_KEY", password: null, sshKey: { privateKey: "enc-key", passphrase: "enc-pass" } });
    const response = await GET(new Request("http://local/api/servers/srv_1/file-proxy"), params);
    expect(response.status).toBe(200);
    expect(mocks.configInputs[0]).toMatchObject({ privateKey: "UNLOCKED-KEY" });
  });

  it("logs in with the password on a password server even when a key is bound", async () => {
    mocks.server.mockResolvedValue({ ...baseServer, connectionType: "PASSWORD", password: "enc-pw", sshKey: { privateKey: "enc-key", passphrase: null } });
    await GET(new Request("http://local/api/servers/srv_1/file-proxy"), params);
    expect(mocks.configInputs[0]).toMatchObject({ password: "plain:enc-pw" });
    expect(mocks.configInputs[0]).not.toHaveProperty("privateKey");
  });
});
