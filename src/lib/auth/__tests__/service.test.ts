import { t } from "@/lib/i18n/service-translations";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateUser, changePassword } from "@/lib/auth/service";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { createSessionToken, verifySessionToken } from "@/lib/auth/session";
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
 async function verifiedSession(passwordHash: string, mustChangePassword = false) {
   const row = { id: "u_1", username: "alice", passwordHash, sessionEpoch: 0, mustChangePassword, status: "ACTIVE", roles: [] };
   vi.mocked(prisma.user.findUnique).mockResolvedValue(row as never);
   const token = await createSessionToken({ userId: row.id, username: row.username, roles: [], mustChangePassword, currentTeamId: null });
   return verifySessionToken(token);
 }

 it("updates password hash when current password is correct", async () => {
 const currentHash = await hashPassword("19970103");
 const session = await verifiedSession(currentHash, true);
 vi.mocked(prisma.user.updateMany).mockResolvedValueOnce({ count: 1 });

 const result = await changePassword({
 currentPassword: "19970103",
 newPassword: "Newpass123",
 confirmPassword: "Newpass123",
 }, session);

 expect(result.success).toBe(true);
 expect(prisma.user.updateMany).toHaveBeenCalledWith(
 expect.objectContaining({
 where: { id: "u_1", passwordHash: currentHash, sessionEpoch: 0, mustChangePassword: true, status: { not: "DISABLED" } },
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
 const session = await verifiedSession(currentHash);

 await expect(
 changePassword({
 currentPassword: "wrong-password",
 newPassword: "Newpass123",
 confirmPassword: "Newpass123",
 }, session),
 ).resolves.toEqual({ success: false, error: t("backend.auth.currentPasswordIncorrect") });
 expect(prisma.user.update).not.toHaveBeenCalled();
 expect(prisma.user.updateMany).not.toHaveBeenCalled();
 }, 15_000);

 it("rejects a session revoked before the password row was read", async () => {
   const passwordHash = await hashPassword("Temporary123");
   const session = await verifiedSession(passwordHash);
   vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u_1", sessionEpoch: 1, passwordHash, mustChangePassword: false } as never);

   await expect(changePassword({
     currentPassword: "Temporary123", newPassword: "Newpass123", confirmPassword: "Newpass123",
   }, session)).rejects.toMatchObject({ code: "AUTH_REQUIRED" });
   expect(prisma.user.updateMany).not.toHaveBeenCalled();
 });

 it.each(["same", "legacy equivalent"])("rejects the %s password during a forced change", async (kind) => {
   const legacy = kind === "legacy equivalent";
   const currentPassword = legacy ? "a".repeat(72) + "1" : "Temporary123";
   const newPassword = legacy ? "a".repeat(72) + "2" : currentPassword;
   const passwordHash = legacy
     ? await (await import("bcrypt")).hash(currentPassword, 4)
     : await hashPassword(currentPassword);
   const session = await verifiedSession(passwordHash);
   vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({ id: "u_1", sessionEpoch: 0, passwordHash, mustChangePassword: true } as never);

   await expect(changePassword({ currentPassword, newPassword, confirmPassword: newPassword }, session))
     .rejects.toMatchObject({ code: "VALIDATION_FAILED", message: t("backend.auth.temporaryPasswordReused") });
   expect(prisma.user.findUnique).toHaveBeenLastCalledWith(expect.objectContaining({ select: expect.objectContaining({ mustChangePassword: true }) }));
   expect(prisma.user.updateMany).not.toHaveBeenCalled();
 }, 15_000);
});
