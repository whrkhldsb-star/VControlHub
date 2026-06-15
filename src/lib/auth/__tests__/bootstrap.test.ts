import { describe, expect, it, vi, beforeEach } from "vitest";

import {
  ADMIN_BOOTSTRAP,
  getInitialAdminPassword,
  getInitialAdminProfile,
  verifyAdminPasswordConsistency,
} from "@/lib/auth/bootstrap";
import { hashPassword, verifyPassword } from "@/lib/auth/password";

const { mockPrisma, mockConfig } = vi.hoisted(() => ({
  mockPrisma: { user: { findUnique: vi.fn() } },
  mockConfig: { auth: { adminInitialPassword: "test-password" as string | undefined }, isProduction: false },
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/config/env", () => ({ config: mockConfig }));

describe("auth bootstrap", () => {
  it("keeps the initial admin username stable and requires password rotation", () => {
    const profile = getInitialAdminProfile();

    expect(profile.username).toBe("admin");
    expect(profile.mustChangePassword).toBe(true);
    expect(profile.status).toBe("PENDING_PASSWORD_RESET");
    expect(ADMIN_BOOTSTRAP.displayName).toContain("Admin");
  });

  it("hashes and verifies the initial password", async () => {
    const hash = await hashPassword(getInitialAdminPassword());

    expect(hash).not.toBe(getInitialAdminPassword());
    await expect(verifyPassword(getInitialAdminPassword(), hash)).resolves.toBe(true);
    await expect(verifyPassword("wrong-password", hash)).resolves.toBe(false);
  });
});

describe("verifyAdminPasswordConsistency (TR-051)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockConfig.auth.adminInitialPassword = "test-password";
  });

  it("env 未设置 ADMIN_INITIAL_PASSWORD 时返 no_env_password", async () => {
    mockConfig.auth.adminInitialPassword = undefined;
    const result = await verifyAdminPasswordConsistency();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_env_password");
  });

  it("DB 中不存在 admin 用户时返 no_admin", async () => {
    mockPrisma.user.findUnique.mockResolvedValueOnce(null);
    const result = await verifyAdminPasswordConsistency();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("no_admin");
  });

  it("env 密码与 DB hash 一致时返 ok=true", async () => {
    const hash = await hashPassword("test-password");
    mockPrisma.user.findUnique.mockResolvedValueOnce({ passwordHash: hash });
    const result = await verifyAdminPasswordConsistency();
    expect(result).toEqual({ ok: true, username: "admin" });
  });

  it("env 密码与 DB hash 不一致时返 hash_mismatch + 详细 message", async () => {
    const wrongHash = await hashPassword("different-password");
    mockPrisma.user.findUnique.mockResolvedValueOnce({ passwordHash: wrongHash });
    const result = await verifyAdminPasswordConsistency();
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("hash_mismatch");
      expect(result.message).toContain("ADMIN_INITIAL_PASSWORD");
      expect(result.message).toContain("admin");
    }
  });
});
