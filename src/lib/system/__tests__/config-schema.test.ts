/**
 * TR-042: 系统配置导出/导入 — schema 验证测试
 */
import { describe, it, expect } from "vitest";
import {
  EXPORT_SCHEMA_VERSION,
  exportFileSchema,
  importOptionsSchema,
  isSensitiveSettingKey,
} from "@/lib/system/config-schema";

describe("config-schema", () => {
  describe("EXPORT_SCHEMA_VERSION", () => {
    it("should be a positive integer", () => {
      expect(EXPORT_SCHEMA_VERSION).toBeGreaterThan(0);
      expect(Number.isInteger(EXPORT_SCHEMA_VERSION)).toBe(true);
    });
  });

  describe("exportFileSchema", () => {
    it("should validate a minimal valid export file", () => {
      const minimal = {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sourceDomain: "test.example.com",
        tables: {
          permissions: [],
          roles: [],
          rolePermissions: [],
          users: [],
          userRoles: [],
          sshKeys: [],
          servers: [],
          storageNodes: [],
          userStorageAccess: [],
          commandTemplates: [],
          quickServices: [],
          playbooks: [],
          alertRules: [],
          settings: [],
          aiProviders: [],
          announcements: [],
          snippets: [],
        },
      };
      const result = exportFileSchema.safeParse(minimal);
      expect(result.success).toBe(true);
    });

    it("should reject an export file with wrong schema version", () => {
      const bad = {
        schemaVersion: 999,
        exportedAt: new Date().toISOString(),
        sourceDomain: "test",
        tables: {},
      };
      const result = exportFileSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });

    it("should reject an export file missing tables", () => {
      const bad = {
        schemaVersion: EXPORT_SCHEMA_VERSION,
        exportedAt: new Date().toISOString(),
        sourceDomain: "test",
      };
      const result = exportFileSchema.safeParse(bad);
      expect(result.success).toBe(false);
    });
  });

  describe("incoming snapshot fields", () => {
    const schema = exportFileSchema.shape.tables;
    const alert = { id: "rule", name: "Rule", metric: "cpu_usage", operator: "gt", threshold: 90, durationSeconds: 0,
      cooldownMinutes: 5, serverIds: [], notifyChannels: ["in_app"], webhookUrl: null, silenceWindows: [], enabled: true, createdAt: "2026-01-01" };
    it.each([{ metric: "unrecognized" }, { operator: "other" }, { threshold: -1 }, { cooldownMinutes: 0 }])("refuses unexecutable alert conditions %j", (fields) => {
      expect(schema.shape.alertRules.safeParse([alert]).success).toBe(true);
      expect(schema.shape.alertRules.safeParse([{ ...alert, ...fields }]).success).toBe(false);
    });

    it("rejects explicit standard secrets, unknown account statuses, invalid content and unusable SSH ports", () => {
      const empty = Object.fromEntries(Object.keys(schema.shape).map((key) => [key, []]));
      const user = { id: "user", username: "operator", displayName: null, status: "ACTIVE", passwordHash: "old-hash", mustChangePassword: false,
        twoFactorEnabled: false, twoFactorSecret: null, preferences: null, createdAt: "2026-01-01" };
      const legacy = { schemaVersion: 1, exportedAt: "2026-01-01", sourceDomain: "test", tables: { ...empty, users: [user] } };
      expect(exportFileSchema.safeParse(legacy).success).toBe(true);
      expect(exportFileSchema.safeParse({ ...legacy, exportMode: "standard" }).success).toBe(false);
      expect(schema.shape.users.safeParse([{ ...user, status: "unknown" }]).success).toBe(false);
      const server = { id: "server", name: "host", host: "example.test", port: 22, connectionType: "SSH_KEY", username: "root", sshKeyId: null,
        description: null, tags: [], enabled: true, publicUrl: null, fileProxyPort: 0, osDialect: null, osInfo: null, createdAt: "2026-01-01" };
      expect(schema.shape.servers.safeParse([server]).success).toBe(true);
      for (const port of [0, 65536, 2.5]) expect(schema.shape.servers.safeParse([{ ...server, port }]).success).toBe(false);
      const content = { id: "content", title: "Notice", body: "body", level: "info", pinned: false, published: true, startsAt: null,
        expiresAt: null, createdBy: null, createdAt: "2026-01-01" };
      expect(schema.shape.announcements.safeParse([content]).success).toBe(true);
      for (const fields of [{ title: " " }, { body: "" }, { level: "unknown" }]) expect(schema.shape.announcements.safeParse([{ ...content, ...fields }]).success).toBe(false);
    });
  });

  describe("importOptionsSchema", () => {
    it("should accept default options", () => {
      const opts = {
        dryRun: true,
        overwriteExisting: true,
        importUsers: true,
        importSettings: true,
      };
      const result = importOptionsSchema.safeParse(opts);
      expect(result.success).toBe(true);
    });

    it("should accept minimal options with defaults", () => {
      const opts = { dryRun: false };
      const result = importOptionsSchema.safeParse(opts);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data.overwriteExisting).toBe(true);
        expect(result.data.importUsers).toBe(true);
        expect(result.data.importSettings).toBe(true);
      }
    });

    it("should reject non-boolean dryRun", () => {
      const opts = { dryRun: "yes" };
      const result = importOptionsSchema.safeParse(opts);
      expect(result.success).toBe(false);
    });
  });

  describe("isSensitiveSettingKey", () => {
    it("should detect SMTP password key", () => {
      expect(isSensitiveSettingKey("smtp.password")).toBe(true);
    });

    it("should detect Telegram bot token key", () => {
      expect(isSensitiveSettingKey("telegram.botToken")).toBe(true);
    });

    it("should detect S3 secret key", () => {
      expect(isSensitiveSettingKey("offsite.s3SecretKey")).toBe(true);
    });

    it("clears every secret the settings service stores encrypted (H-2)", () => {
      // The real keys: "smtp.pass", not "smtp.password", and the offsite S3 pair.
      for (const key of ["smtp.pass", "offsite.accessKeyId", "offsite.secretAccessKey", "telegram.botToken"]) {
        expect(isSensitiveSettingKey(key)).toBe(true);
      }
      // Policy settings named after passwords are not secrets.
      expect(isSensitiveSettingKey("password.minLength")).toBe(false);
    });

    it("should not flag non-sensitive keys", () => {
      expect(isSensitiveSettingKey("platform.name")).toBe(false);
      expect(isSensitiveSettingKey("smtp.host")).toBe(false);
    });
  });
});