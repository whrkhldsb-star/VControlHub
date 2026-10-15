// @vitest-environment node
/**
 * The /settings server component must not ship decrypted secrets to the
 * browser: everything handed to the client component ends up in the RSC/HTML
 * payload. Runs the real settings service over a mocked table.
 */
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const SMTP_PASSWORD = "smtp-plaintext-password-7f3a";
const BOT_TOKEN = "123456:telegram-plaintext-token-9c1d";

const { prismaMock, clientProps } = vi.hoisted(() => ({
  prismaMock: {
    setting: { findMany: vi.fn(), findUnique: vi.fn() },
    auditLog: { findMany: vi.fn() },
  },
  clientProps: [] as Array<Record<string, unknown>>,
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/crypto/service", () => ({
  encrypt: (value: string) => `enc:${value}`,
  decrypt: (value: string) => value.replace(/^enc:/, ""),
  isEncrypted: (value: string) => value.startsWith("enc:"),
}));
vi.mock("@/lib/auth/require-session", () => ({
  requireSession: vi.fn(async () => ({ userId: "admin", role: "admin", permissions: ["user:manage"] })),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: () => true }));
vi.mock("@/lib/system/platform-admin", () => ({ isPlatformAdmin: () => true }));
vi.mock("@/lib/preferences/user-preferences", () => ({ getAvailableDefaultPageOptions: () => [] }));
vi.mock("@/components/page-shell", () => ({ PageShell: ({ children }: { children: React.ReactNode }) => children }));
vi.mock("../unified-settings-page-client", () => ({
  UnifiedSettingsPageClient: (props: Record<string, unknown>) => {
    clientProps.push(props);
    return null;
  },
}));

const { default: SettingsPage } = await import("../page");

describe("/settings page payload", () => {
  beforeEach(() => {
    clientProps.length = 0;
    prismaMock.setting.findUnique.mockResolvedValue(null);
    prismaMock.auditLog.findMany.mockResolvedValue([]);
    prismaMock.setting.findMany.mockImplementation(async (args: { select: Record<string, boolean> }) => {
      if (args.select.updatedAt) return [];
      return [
        { key: "smtp.enabled", value: "true" },
        { key: "smtp.user", value: "mailer" },
        { key: "smtp.pass", value: `enc:${SMTP_PASSWORD}` },
        { key: "telegram.botToken", value: `enc:${BOT_TOKEN}` },
        { key: "offsite.secretAccessKey", value: "enc:" },
      ];
    });
  });

  it("masks stored secrets and leaves unset ones empty", async () => {
    renderToStaticMarkup(await SettingsPage());

    expect(clientProps).toHaveLength(1);
    const serialized = JSON.stringify(clientProps[0]);
    expect(serialized).not.toContain(SMTP_PASSWORD);
    expect(serialized).not.toContain(BOT_TOKEN);
    const settings = clientProps[0]!.settings as Record<string, string>;
    expect(settings["smtp.pass"]).toBe("***");
    expect(settings["telegram.botToken"]).toBe("***");
    // Cleared or never set: nothing to keep, so nothing to mask.
    expect(settings["offsite.secretAccessKey"]).toBe("");
    expect(settings["offsite.accessKeyId"]).toBe("");
    // Ordinary values still reach the form.
    expect(settings["smtp.user"]).toBe("mailer");
    expect(settings["smtp.enabled"]).toBe("true");
  });
});
