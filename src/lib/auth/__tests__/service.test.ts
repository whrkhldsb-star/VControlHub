import { t } from "@/lib/i18n/service-translations";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateUser, changePassword } from "@/lib/auth/service";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
 prisma: {
 user: {
 findUnique: vi.fn(),
 update: vi.fn(),
 updateMany: vi.fn(),
 },
 setting: {
 findUnique: vi.fn(),
 },
 auditLog: {
 create: vi.fn(),
 },
 },
 isDatabaseUnavailableError: vi.fn(() => false),
}));

beforeEach(() => {
 vi.clearAllMocks();
});

describe("authenticateUser", () => {
 it("upgrades a legacy bcrypt hash with CAS and binds the login to the installed hash", async () => {
   const bcrypt = await import("bcrypt");
   const password = "Legacy-Audit-Password-2026!";
   const oldHash = await bcrypt.hash(password, 4);
   vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "legacy", username: "legacy", passwordHash: oldHash, sessionEpoch: 3, status: "ACTIVE", mustChangePassword: false, roles: [], teamMembership: null } as never);
   vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 });
   const result = await authenticateUser({ username: "legacy", password });
   const call = vi.mocked(prisma.user.updateMany).mock.calls[0]?.[0];
   expect(call?.where).toMatchObject({ id: "legacy", passwordHash: oldHash, sessionEpoch: 3, status: { not: "DISABLED" } });
   const newHash = call?.data.passwordHash as string;
   expect(newHash).toMatch(/^vch-bcrypt-sha256-v1:/);
   expect(await verifyPassword(password, newHash)).toBe(true);
   expect(result).not.toBeNull();
 });
 it.each(["a".repeat(72), "密".repeat(24), "b".repeat(80)])("requires reset when the legacy hash cannot establish the suffix", async (password) => {
   const bcrypt = await import("bcrypt");
   const oldHash = await bcrypt.hash(password, 4);
   vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "legacy", username: "legacy", passwordHash: oldHash, sessionEpoch: 3, status: "ACTIVE", mustChangePassword: false, roles: [] } as never);
   vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 });
   expect((await authenticateUser({ username: "legacy", password }))?.mustChangePassword).toBe(true);
 });
 it("does not mint a login if disable/reset wins a legacy hash upgrade", async () => {
   const bcrypt = await import("bcrypt");
   const password = "Legacy-Audit-Password-2026!";
   const oldHash = await bcrypt.hash(password, 4);
   vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "legacy", username: "legacy", passwordHash: oldHash, sessionEpoch: 3, status: "ACTIVE", roles: [] } as never);
   vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 0 });
   expect(await authenticateUser({ username: "legacy", password })).toBeNull();
 });
 it("returns null when the user does not exist", async () => {
 vi.mocked(prisma.user.findUnique).mockResolvedValueOnce(null);

 await expect(
 authenticateUser({ username: "ghost", password: "19970103" }),
 ).resolves.toBeNull();
 });

 it("returns normalized roles and permissions when the password is valid", async () => {
 const passwordHash = await hashPassword("19970103");

 vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
 id: "u_1",
 username: "admin",
 displayName: "Platform Admin",
 mustChangePassword: true,
 status: "PENDING_PASSWORD_RESET",
 passwordHash,
 twoFactorEnabled: true,
 twoFactorSecret: "sealed:TOTP",
 createdAt: new Date(),
 updatedAt: new Date(),
 roles: [{ role: { key: "admin" } }, { role: { key: "viewer" } }],
 } as any);

 const result = await authenticateUser({
 username: "admin",
 password: "19970103",
 });

 expect(result?.roles).toEqual(["admin", "viewer"]);
 expect(result?.permissions).toContain("command:execute");
 expect(result?.mustChangePassword).toBe(true);
 expect(result?.hasTwoFactorSecret).toBe(true);
 expect(result).not.toHaveProperty("twoFactorSecret");
 });

 it("rejects disabled users even when the password is valid", async () => {
 const passwordHash = await hashPassword("19970103");
 vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
 id: "u_2",
 username: "disabled",
 displayName: null,
 mustChangePassword: false,
 status: "DISABLED",
 passwordHash,
 createdAt: new Date(),
 updatedAt: new Date(),
 roles: [{ role: { key: "admin" } }],
 } as any);

 await expect(authenticateUser({ username: "disabled", password: "19970103" })).resolves.toBeNull();
 });
});

describe("changePassword", () => {
 it("updates password hash when current password is correct", async () => {
 const currentHash = await hashPassword("19970103");

 vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
 id: "u_1",
 passwordHash: currentHash,
 } as any);
 vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 });

 const result = await changePassword({
 userId: "u_1",
 currentPassword: "19970103",
 newPassword: "Newpass123",
 confirmPassword: "Newpass123",
 });

 expect(result.success).toBe(true);
 expect(prisma.user.updateMany).toHaveBeenCalledWith(
 expect.objectContaining({
 where: { id: "u_1", passwordHash: currentHash, sessionEpoch: 0, status: { not: "DISABLED" } },
 data: expect.objectContaining({
 mustChangePassword: false,
 status: "ACTIVE",
 }),
 }),
 );
 const updateCall = vi.mocked(prisma.user.updateMany).mock.calls[0]?.[0];
 const newHash = updateCall?.data?.passwordHash as string;
 expect(typeof newHash).toBe("string");
 expect(await verifyPassword("Newpass123", newHash)).toBe(true);
 expect(result.success && result.credentialBinding.epoch).toBe(1);
 }, 15_000);

 it("rejects password change when current password is invalid", async () => {
 const currentHash = await hashPassword("19970103");

 vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
 id: "u_1",
 passwordHash: currentHash,
 } as any);

 await expect(
 changePassword({
 userId: "u_1",
 currentPassword: "wrong-password",
 newPassword: "Newpass123",
 confirmPassword: "Newpass123",
 }),
 ).resolves.toEqual({ success: false, error: t("backend.auth.currentPasswordIncorrect") });
 expect(prisma.user.update).not.toHaveBeenCalled();
 expect(prisma.user.updateMany).not.toHaveBeenCalled();
 }, 15_000);
});
