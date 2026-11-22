import { beforeEach, describe, expect, it, vi } from "vitest";

const {
	findUniqueMock,
	sessionHasPermissionMock,
	buildSshParamsMock,
	resolveRealPathMock,
} = vi.hoisted(() => ({
	findUniqueMock: vi.fn(),
	sessionHasPermissionMock: vi.fn(),
	buildSshParamsMock: vi.fn(),
	resolveRealPathMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
	prisma: { server: { findUnique: findUniqueMock } },
}));
vi.mock("@/lib/auth/authorization", () => ({
	sessionHasPermission: sessionHasPermissionMock,
}));
vi.mock("../client", () => ({
	buildSshParamsFromServer: buildSshParamsMock,
	resolveRemoteHomeDirectory: vi.fn(async () => "/home/alice"),
	resolveRemoteRealPath: resolveRealPathMock,
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
		findUniqueMock.mockResolvedValue({
			id: "s1",
			host: "h",
			port: 22,
			username: "alice",
			enabled: true,
			connectionType: "PASSWORD",
			password: "enc",
			managementMode: "DIRECT",
			hostKeySha256: "SHA256:pin",
			sshKey: null,
		});
		buildSshParamsMock.mockResolvedValue({ host: "h", port: 22, username: "alice", hostKeySha256: "SHA256:pin" });
		// Default: realpath is an identity (no symlinks) so lexical == canonical.
		resolveRealPathMock.mockImplementation(async ({ remotePath }: { remotePath: string }) =>
			remotePath.startsWith("/") ? remotePath : `/home/alice/${remotePath}`,
		);
	});

	it("allows operators inside the SSH user's home directory", async () => {
		await expect(assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice/files/a.txt"] })).resolves.toEqual({ path: "/home/alice", windows: false, canonical: ["/home/alice/files/a.txt"] });
	});

	it("rejects traversal and absolute paths outside the home directory", async () => {
		await expect(assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice/../../etc/passwd"] })).rejects.toThrow("outside the allowed home directory");
		await expect(assertSftpPathAccess({ session, serverId: "s1", paths: ["/etc/passwd"] })).rejects.toThrow("outside the allowed home directory");
	});

	it("denies a restricted operator when the host cannot verify the account home", async () => {
		const { resolveRemoteHomeDirectory } = await import("../client");
		buildSshParamsMock.mockResolvedValueOnce({ username: "alice", host: "uncached-host", port: 22, hostKeySha256: "SHA256:pin", password: "fixture" });
		vi.mocked(resolveRemoteHomeDirectory).mockRejectedValueOnce(new Error("unavailable"));
		await expect(assertSftpPathAccess({ session, serverId: "uncached-endpoint", paths: ["/home/alice"] }))
			.rejects.toMatchObject({ status: 403 });
		expect(resolveRealPathMock).not.toHaveBeenCalled();
	});

	it("allows administrators with the unrestricted permission", async () => {
		sessionHasPermissionMock.mockReturnValue(true);
		await expect(assertSftpPathAccess({ session: { ...session, roles: ["admin"] }, serverId: "s1", paths: ["/etc/passwd"] })).resolves.toBeUndefined();
		expect(findUniqueMock).not.toHaveBeenCalled();
	});

	it("rejects sibling paths that share a home-prefix string (alice vs alice-evil)", async () => {
		await expect(
			assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice-evil/secret"] }),
		).rejects.toThrow("outside the allowed home directory");
	});

	it("rejects relative paths, whose base is the remote login directory rather than the allowed root", async () => {
		await expect(
			assertSftpPathAccess({ session, serverId: "s1", paths: ["files/a.txt"] }),
		).rejects.toThrow("outside the allowed home directory");
	});

	it("rejects a lexically-valid path whose symlink resolves outside home", async () => {
		// ~/link -> / , so ~/link/etc/shadow passes the lexical check but the
		// remote realpath canonicalises to /etc/shadow (outside home).
		resolveRealPathMock.mockResolvedValueOnce("/etc/shadow");
		await expect(
			assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice/link/etc/shadow"] }),
			// Message is translated (zh default / en), so match either locale rather
			// than pinning English copy that i18n will keep breaking.
		).rejects.toThrow(/超出允许的主目录|resolves outside the allowed home directory/);
	});

	it("fails closed when remote realpath cannot be resolved", async () => {
		resolveRealPathMock.mockRejectedValueOnce(new Error("connection refused"));
		await expect(
			assertSftpPathAccess({ session, serverId: "s1", paths: ["/home/alice/files/a.txt"] }),
		).rejects.toThrow(/无法校验 SFTP 路径|Unable to verify SFTP path/);
	});
});
