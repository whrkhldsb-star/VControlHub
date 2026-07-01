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

    it("should not flag non-sensitive keys", () => {
      expect(isSensitiveSettingKey("platform.name")).toBe(false);
      expect(isSensitiveSettingKey("smtp.host")).toBe(false);
    });
  });
});