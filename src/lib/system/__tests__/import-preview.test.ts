/** @vitest-environment node */
import { createCipheriv, randomBytes, scryptSync } from "node:crypto";
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
  previewTeams: stub(),
  previewIdentityTemplates: stub(),
  previewTeamMembers: stub(),
  previewUserServerAccess: stub(),
};

vi.mock("../import-preview-tables", () => stubs);
const alignment = vi.hoisted(() => ({ missing: [] as string[] }));
// Id alignment has its own tests; here the package is taken as is.
vi.mock("@/lib/db", () => ({ prisma: {} }));
vi.mock("../import-id-alignment", () => ({
  alignImportIds: vi.fn(async (_db: unknown, tables: unknown) => tables),
  findMissingTeamIds: vi.fn(async () => alignment.missing),
}));

const { previewImport } = await import("../import-preview");
const { zh, en } = await import("@/lib/i18n/dictionaries/system-config");

const OPTIONS = {
  dryRun: true,
  overwriteExisting: true,
  importUsers: true,
  importSettings: true,
} satisfies ImportOptions;

/** What another instance (another ENCRYPTION_KEY) stores: lib/crypto's envelope. */
function encryptWithKey(passphrase: string, plaintext: string) {
  const salt = randomBytes(16);
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", scryptSync(passphrase, salt, 32), iv);
  const data = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return [salt, iv, cipher.getAuthTag(), data].map((part) => part.toString("base64")).join(":");
}

function file(over: Record<string, unknown> = {}): ExportFile {
  const empty = Object.fromEntries(
    [
      "teams",
      "identityTemplates",
      "teamMembers",
      "userServerAccess",
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
  alignment.missing = [];
});

describe("previewImport", () => {
  it("reports one summary row per table, and only i18n keys", async () => {
    const preview = await previewImport(file(), OPTIONS);

    const keys = Object.keys(preview.summary);
    expect(keys).toHaveLength(21);
    for (const key of keys) {
      expect(key).toMatch(/^systemConfig\.import\.preview\.table\./);
      expect(zh[key]).toBeTypeOf("string");
      expect(en[key]).toBeTypeOf("string");
    }
  });

  it("warns before importing a package whose customers cannot be found, and about Agent nodes", async () => {
    alignment.missing = ["team-gone"];
    const preview = await previewImport(file({ tables: { servers: [{ id: "s1", managementMode: "AGENT" }] } }), OPTIONS);
    expect(preview.warnings).toEqual(expect.arrayContaining([
      "systemConfig.import.preview.warning.missingCustomers",
      "systemConfig.import.preview.warning.agentReinstall",
    ]));
  });

  it("warns when a full export's credentials were encrypted with another key", async () => {
    // They imported without a word and failed on first use.
    const { encrypt } = await import("@/lib/crypto/service");
    const { encryptServerPassword } = await import("@/lib/ssh/ssh-key-crypto");
    const warning = "systemConfig.import.preview.warning.credentialsNeedSourceKey";
    const ours = await previewImport(file({
      exportMode: "full",
      tables: { servers: [{ id: "s1", password: encryptServerPassword("pw"), rdpPassword: encrypt("rdp") }], sshKeys: [{ id: "k1", privateKey: encrypt("key") }] },
    }), OPTIONS);
    expect(ours.warnings).not.toContain(warning);

    for (const tables of [
      { servers: [{ id: "s1", password: `enc:v1:${encryptWithKey("another instance", "pw")}` }] },
      { sshKeys: [{ id: "k1", privateKey: encryptWithKey("another instance", "key") }] },
      { aiProviders: [{ id: "p1", apiKey: encryptWithKey("another instance", "sk") }] },
      { storageNodes: [{ id: "n1", webdavConfigEncrypted: encryptWithKey("another instance", "{}") }] },
    ]) {
      expect((await previewImport(file({ exportMode: "full", tables }), OPTIONS)).warnings).toContain(warning);
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

    // 19 tables contribute create+update (customer memberships and per-server
    // access can be overwritten); the two pure join tables contribute create only.
    expect(preview.totalRecords).toBe(19 * 3 + 2 * 1);
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
