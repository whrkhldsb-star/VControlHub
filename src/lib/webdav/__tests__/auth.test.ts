import { beforeEach, describe, expect, it, vi } from "vitest";

const { verifyApiTokenMock, loadOwnerSessionMock } = vi.hoisted(() => ({
	verifyApiTokenMock: vi.fn(),
	loadOwnerSessionMock: vi.fn(),
}));

vi.mock("@/lib/api-token/service", () => ({
	verifyApiToken: verifyApiTokenMock,
}));
vi.mock("@/lib/api-token/authorization", () => ({
	loadApiTokenOwnerSession: loadOwnerSessionMock,
}));

import { authenticateWebDavRequest } from "../auth";

describe("WebDAV token authorization", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		verifyApiTokenMock.mockResolvedValue({
			userId: "user-1",
			tokenId: "token-1",
			scopes: ["storage:write"],
		});
	});

	it("accepts a token only when its owner still has the required permission", async () => {
		loadOwnerSessionMock.mockResolvedValue({
			userId: "user-1",
			username: "storage-user",
			roles: ["storage_manager"],
			mustChangePassword: false,
			currentTeamId: null,
		});

		await expect(
			authenticateWebDavRequest(
				new Request("https://example.test/api/webdav/node/file", {
					headers: { authorization: "Bearer whr_valid" },
				}),
				"PUT",
			),
		).resolves.toMatchObject({ tokenId: "token-1" });
	});

	it("rejects a write token after the owner loses storage write access", async () => {
		loadOwnerSessionMock.mockResolvedValue({
			userId: "user-1",
			username: "viewer",
			roles: ["viewer"],
			mustChangePassword: false,
			currentTeamId: null,
		});

		await expect(
			authenticateWebDavRequest(
				new Request("https://example.test/api/webdav/node/file", {
					headers: { authorization: "Bearer whr_valid" },
				}),
				"PUT",
			),
		).rejects.toThrow("Invalid or insufficient WebDAV token");
	});
});
