import { beforeEach, describe, expect, it, vi } from "vitest";

const { findUniqueMock, sessionHasPermissionMock } = vi.hoisted(() => ({
	findUniqueMock: vi.fn(),
	sessionHasPermissionMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: { server: { findUnique: findUniqueMock } },
}));
vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: sessionHasPermissionMock,
}));

import { assertSftpPathAccess } from "../sftp-access-control";

const session = {
	userId: "u1",
	username: "operator",
	roles: ["operator" as const],
	mustChangePassword: false,
	currentTeamId: null,
};

describe("assertSftpPathAccess", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		sessionHasPermissionMock.mockReturnValue(false);
		findUniqueMock.mockResolvedValue({ username: "alice", enabled: true });
	});

	it("allows operators inside the SSH user's home directory", async () => {
		await expect(assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice/files/a.txt"] })).resolves.toBeUndefined();
	});

	it("rejects traversal and absolute paths outside the home directory", async () => {
		await expect(assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice/../../etc/passwd"] })).rejects.toThrow("outside the allowed home directory");
		await expect(assertSftpPathAccess({ session, serverId: "s1", paths: ["/etc/passwd"] })).rejects.toThrow("outside the allowed home directory");
	});

	it("allows administrators with the unrestricted permission", async () => {
		sessionHasPermissionMock.mockReturnValue(true);
		await expect(assertSftpPathAccess({ session: { ...session, roles: ["admin"] }, serverId: "s1", paths: ["/etc/passwd"] })).resolves.toBeUndefined();
		expect(findUniqueMock).not.toHaveBeenCalled();
	});
});
