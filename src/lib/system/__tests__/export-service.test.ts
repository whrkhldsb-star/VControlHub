/**
 * TR-042: 系统配置导出服务 — 脱敏测试
 *
 * 验证敏感字段在导出时被正确剥离：
 * - User.passwordHash → null
 * - SshKey.privateKey → null
 * - Server.password → null
 * - AiProvider.apiKey → null
 * - Setting sensitive keys → ""
 */
import { describe, it, expect, vi } from "vitest";

// Mock prisma
vi.mock("@/lib/db", () => ({
  prisma: {
    permission: { findMany: vi.fn().mockResolvedValue([]) },
    role: { findMany: vi.fn().mockResolvedValue([]) },
    rolePermission: { findMany: vi.fn().mockResolvedValue([]) },
    user: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "u1",
          username: "admin",
          displayName: "Admin",
          passwordHash: "$2b$12$SECRET_HASH",
          status: "ACTIVE",
          mustChangePassword: false,
          twoFactorEnabled: false,
          twoFactorSecret: "TOTP_SECRET",
          preferences: {},
          createdAt: new Date("2025-01-01"),
          updatedAt: new Date("2025-01-01"),
        },
      ]),
    },
    userRole: { findMany: vi.fn().mockResolvedValue([]) },
    sshKey: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "k1",
          name: "test-key",
          fingerprint: "SHA256:abc",
          publicKey: "ssh-ed25519 AAAA test",
          privateKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nSECRET",
          description: "test key",
          createdAt: new Date("2025-01-01"),
          updatedAt: new Date("2025-01-01"),
        },
      ]),
    },
    server: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "s1",
          name: "test-server",
          host: "1.2.3.4",
          port: 22,
          username: "root",
          password: "SUPER_SECRET_PASSWORD",
          sshKeyId: null,
          description: "test",
          tags: ["prod"],
          enabled: true,
          connectionType: "SSH",
          publicUrl: null,
          fileProxyPort: null,
          osDialect: null,
          osInfo: null,
          createdAt: new Date("2025-01-01"),
          updatedAt: new Date("2025-01-01"),
        },
      ]),
    },
    storageNode: { findMany: vi.fn().mockResolvedValue([]) },
    userStorageAccess: { findMany: vi.fn().mockResolvedValue([]) },
    commandTemplate: { findMany: vi.fn().mockResolvedValue([]) },
    quickService: { findMany: vi.fn().mockResolvedValue([]) },
    playbook: { findMany: vi.fn().mockResolvedValue([]) },
    alertRule: { findMany: vi.fn().mockResolvedValue([]) },
    setting: {
      findMany: vi.fn().mockResolvedValue([
        { key: "platform.name", value: "VControlHub", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01") },
        { key: "smtp.password", value: "SMTP_SECRET", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01") },
        { key: "telegram.botToken", value: "BOT_TOKEN_SECRET", createdAt: new Date("2025-01-01"), updatedAt: new Date("2025-01-01") },
      ]),
    },
    aiProvider: {
      findMany: vi.fn().mockResolvedValue([
        {
          id: "ai1",
          name: "openai",
          provider: "openai",
          apiKey: "sk-SECRET_API_KEY",
          baseUrl: "https://api.openai.com/v1",
          defaultModel: "gpt-4",
          enabled: true,
          createdAt: new Date("2025-01-01"),
          updatedAt: new Date("2025-01-01"),
        },
      ]),
    },
    announcement: { findMany: vi.fn().mockResolvedValue([]) },
    snippet: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

import { buildExportFile } from "@/lib/system/export-service";

describe("export-service sanitization", () => {
  it("should strip User.passwordHash and twoFactorSecret", async () => {
    const result = await buildExportFile("test.example.com");
    const user = result.tables.users[0]!;
    expect(user.passwordHash).toBeNull();
    expect(user.twoFactorSecret).toBeNull();
    expect(user.username).toBe("admin"); // non-sensitive preserved
  });

  it("should strip SshKey.privateKey", async () => {
    const result = await buildExportFile("test.example.com");
    const key = result.tables.sshKeys[0]!;
    expect(key.privateKey).toBeNull();
    expect(key.publicKey).toBe("ssh-ed25519 AAAA test"); // public key preserved
  });

  it("should strip Server.password", async () => {
    const result = await buildExportFile("test.example.com");
    const server = result.tables.servers[0]!;
    expect(server.password).toBeNull();
    expect(server.host).toBe("1.2.3.4"); // non-sensitive preserved
  });

  it("should strip AiProvider.apiKey", async () => {
    const result = await buildExportFile("test.example.com");
    const ai = result.tables.aiProviders[0]!;
    expect(ai.apiKey).toBeNull();
    expect(ai.name).toBe("openai"); // non-sensitive preserved
  });

  it("should clear sensitive Setting values", async () => {
    const result = await buildExportFile("test.example.com");
    const settings = result.tables.settings;
    const smtpPwd = settings.find((s) => s.key === "smtp.password");
    const tgToken = settings.find((s) => s.key === "telegram.botToken");
    const platformName = settings.find((s) => s.key === "platform.name");

    expect(smtpPwd?.value).toBe("");
    expect(tgToken?.value).toBe("");
    expect(platformName?.value).toBe("VControlHub"); // non-sensitive preserved
  });

  it("should set correct schema version and metadata", async () => {
    const result = await buildExportFile("test.example.com");
    expect(result.schemaVersion).toBe(1);
    expect(result.exportedAt).toBeTruthy();
    expect(result.sourceDomain).toBe("test.example.com");
    expect(result.tables).toBeDefined();
  });
});