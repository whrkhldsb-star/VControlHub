import { beforeEach, describe, expect, it, vi } from "vitest";

import { authenticateUser, changePassword } from "@/lib/auth/service";
import { hashPassword, verifyPassword } from "@/lib/auth/password";
import { prisma } from "@/lib/db";

vi.mock("@/lib/db", () => ({
 prisma: {
 user: {
 findUnique: vi.fn(),
 update: vi.fn(),
 },
 },
 isDatabaseUnavailableError: vi.fn(() => false),
}));

beforeEach(() => {
 vi.clearAllMocks();
});

describe("authenticateUser", () => {
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
 });
});

describe("changePassword", () => {
 it("updates password hash when current password is correct", async () => {
 const currentHash = await hashPassword("19970103");

 vi.mocked(prisma.user.findUnique).mockResolvedValueOnce({
 id: "u_1",
 passwordHash: currentHash,
 } as any);
 vi.mocked(prisma.user.update).mockResolvedValueOnce({
 id: "u_1",
 username: "admin",
 displayName: null,
 passwordHash: await hashPassword("newpass123"),
 mustChangePassword: false,
 status: "ACTIVE",
 createdAt: new Date(),
 updatedAt: new Date(),
 } as any);

 const result = await changePassword({
 userId: "u_1",
 currentPassword: "19970103",
 newPassword: "newpass123",
 confirmPassword: "newpass123",
 });

 expect(result.success).toBe(true);
 expect(prisma.user.update).toHaveBeenCalledWith(
 expect.objectContaining({
 where: { id: "u_1" },
 data: expect.objectContaining({
 mustChangePassword: false,
 status: "ACTIVE",
 }),
 }),
 );
 const updateCall = vi.mocked(prisma.user.update).mock.calls[0]?.[0];
 const newHash = updateCall?.data?.passwordHash as string;
 expect(typeof newHash).toBe("string");
 expect(await verifyPassword("newpass123", newHash)).toBe(true);
 });

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
 newPassword: "newpass123",
 confirmPassword: "newpass123",
 }),
 ).resolves.toEqual({ success: false, error: "当前密码错误" });
 expect(prisma.user.update).not.toHaveBeenCalled();
 });
});
