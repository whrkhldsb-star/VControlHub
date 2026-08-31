/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { ExportFile, ImportOptions } from "@/lib/system/config-schema";

/**
 * `previewImport` assembles the dry-run report the settings UI renders verbatim:
 * a per-table summary and a warning list. Both are i18n *keys*, not English
 * text — a server-side `t()` has no request locale here, so translating on the
 * server would pin every operator to zh.
 */

const table = vi.hoisted(() => ({ counts: { create: 1, update: 2, skip: 3 } }));

function stub() {
  return vi.fn(async () => table.counts);
}

const stubs = {
  previewPermissions: stub(),
  previewRoles: stub(),
  previewRolePermissions: stub(),
  previewUsers: stub(),
  previewUserRoles: stub(),
  previewSshKeys: stub(),
  previewServers: stub(),
  previewStorageNodes: stub(),
  previewUserStorageAccess: stub(),
  previewCommandTemplates: stub(),
  previewQuickServices: stub(),
  previewPlaybooks: stub(),
  previewAlertRules: stub(),
  previewSettings: stub(),
  previewAiProviders: stub(),
  previewAnnouncements: stub(),
  previewSnippets: stub(),
};

vi.mock("../import-preview-tables", () => stubs);

const { previewImport } = await import("../import-preview");
const { zh, en } = await import("@/lib/i18n/dictionaries/system-config");

const OPTIONS = {
  dryRun: true,
  overwriteExisting: true,
  importUsers: true,
  importSettings: true,
} satisfies ImportOptions;

function file(over: Record<string, unknown> = {}): ExportFile {
  const empty = Object.fromEntries(
    [
      "permissions",
      "roles",
      "rolePermissions",
      "users",
      "userRoles",
      "sshKeys",
      "servers",
      "storageNodes",
      "userStorageAccess",
      "commandTemplates",
      "quickServices",
      "playbooks",
      "alertRules",
      "settings",
      "aiProviders",
      "announcements",
      "snippets",
    ].map((k) => [k, []]),
  );
  const { tables: tableOverride, ...rest } = over;
  return {
    exportMode: "standard",
    tables: { ...empty, ...(tableOverride as object) },
    ...rest,
  } as unknown as ExportFile;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("previewImport", () => {
  it("reports one summary row per table, and only i18n keys", async () => {
    const preview = await previewImport(file(), OPTIONS);

    const keys = Object.keys(preview.summary);
    expect(keys).toHaveLength(17);
    for (const key of keys) {
      expect(key).toMatch(/^systemConfig\.import\.preview\.table\./);
      expect(zh[key]).toBeTypeOf("string");
      expect(en[key]).toBeTypeOf("string");
    }
  });

  it("emits warnings as i18n keys that both dictionaries resolve", async () => {
    const preview = await previewImport(
      file({ tables: { users: [{ id: "u1" }], sshKeys: [{ id: "k1" }] } }),
      OPTIONS,
    );

    expect(preview.warnings.length).toBeGreaterThan(0);
    for (const warning of preview.warnings) {
      expect(warning).toMatch(/^systemConfig\.import\.preview\.warning\./);
      expect(zh[warning]).toBeTypeOf("string");
      expect(en[warning]).toBeTypeOf("string");
    }
  });

  it("counts creates and updates towards the total but never skips", async () => {
    // totalRecords gates the Execute button; a skipped record writes nothing, so
    // counting it would enable an import that does nothing.
    const preview = await previewImport(file(), OPTIONS);

    // 15 tables contribute create+update; the two pure join tables contribute
    // create only.
    expect(preview.totalRecords).toBe(15 * 3 + 2 * 1);
  });

  it("does not query the users table when user import is off, and says so", async () => {
    const preview = await previewImport(
      file({ tables: { users: [{ id: "u1" }, { id: "u2" }] } }),
      { ...OPTIONS, importUsers: false },
    );

    expect(stubs.previewUsers).not.toHaveBeenCalled();
    expect(preview.summary["systemConfig.import.preview.table.users"]).toEqual({
      create: 0,
      update: 0,
      skip: 2,
    });
    expect(preview.warnings).toContain("systemConfig.import.preview.warning.usersSkipped");
  });

  it("does not query the settings table when settings import is off, and says so", async () => {
    const preview = await previewImport(
      file({ tables: { settings: [{ key: "a", value: "b" }] } }),
      { ...OPTIONS, importSettings: false },
    );

    expect(stubs.previewSettings).not.toHaveBeenCalled();
    expect(preview.summary["systemConfig.import.preview.table.settings"]).toEqual({
      create: 0,
      update: 0,
      skip: 1,
    });
    expect(preview.warnings).toContain("systemConfig.import.preview.warning.settingsSkipped");
  });

  it("warns about each kind of stripped secret only when that table has rows", async () => {
    const bare = await previewImport(file(), OPTIONS);
    expect(bare.warnings).toEqual([]);

    const loaded = await previewImport(
      file({
        tables: {
          users: [{ id: "u1" }],
          sshKeys: [{ id: "k1" }],
          servers: [{ id: "s1" }],
          aiProviders: [{ id: "a1" }],
          settings: [{ key: "smtp.password", value: "" }],
        },
      }),
      OPTIONS,
    );
    expect(loaded.warnings).toEqual([
      "systemConfig.import.preview.warning.passwordsStripped",
      "systemConfig.import.preview.warning.sshKeysStripped",
      "systemConfig.import.preview.warning.serverPasswordsStripped",
      "systemConfig.import.preview.warning.aiKeysStripped",
      "systemConfig.import.preview.warning.settingsCleared",
    ]);
  });

  it("does not claim a setting was cleared when its value is merely absent from view", async () => {
    const preview = await previewImport(
      file({ tables: { settings: [{ key: "site.name", value: "VControlHub" }] } }),
      OPTIONS,
    );

    expect(preview.warnings).not.toContain(
      "systemConfig.import.preview.warning.settingsCleared",
    );
  });

  it("replaces the stripped-secret notes with a single custody warning in full mode", async () => {
    const preview = await previewImport(
      file({
        exportMode: "full",
        tables: { users: [{ id: "u1" }], sshKeys: [{ id: "k1" }] },
      }),
      OPTIONS,
    );

    // Nothing was stripped in full mode, so the "must be reset" notes would be
    // wrong; the file itself is the risk.
    expect(preview.warnings).toEqual([
      "systemConfig.import.preview.warning.fullModeSensitive",
    ]);
  });
});
