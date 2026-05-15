import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiTokenManagerClient } from "../api-token-manager-client";

const token = {
	id: "tok_1",
	name: "CLI",
	tokenPrefix: "whr_1234",
	tokenSuffix: "abcdef",
	scopes: ["read", "health:read"],
	expiresAt: null,
	lastUsedAt: null,
	revokedAt: null,
	createdAt: new Date("2026-01-01T00:00:00Z"),
};

describe("ApiTokenManagerClient", () => {
	beforeEach(() => {
		vi.restoreAllMocks();
	});

	it("creates an API token through JSON and shows the plaintext only in the one-time result panel", async () => {
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			status: 201,
			json: async () => ({
				token: "whr_plain_once",
				apiToken: { ...token, id: "tok_2", name: "mobile", scopes: ["read", "status:read"], tokenSuffix: "n_once" },
			}),
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient initialTokens={[token]} allowedScopes={["read", "health:read", "status:read"]} />);

		fireEvent.change(screen.getByLabelText("Token 名称"), { target: { value: "mobile" } });
		fireEvent.click(screen.getByLabelText("status:read"));
		fireEvent.click(screen.getByRole("button", { name: "创建 Token" }));

		await screen.findByText("请立即复制，此明文 Token 离开页面后无法再次查看。");
		expect(screen.getByText("whr_plain_once")).toBeInTheDocument();
		expect(fetchMock).toHaveBeenCalledWith("/api/api-tokens", expect.objectContaining({
			method: "POST",
			body: JSON.stringify({ name: "mobile", scopes: ["read", "status:read"], expiresAt: null }),
		}));
		expect(screen.getByText("mobile")).toBeInTheDocument();
	});

	it("revokes an API token after confirmation and updates the list", async () => {
		vi.spyOn(window, "confirm").mockReturnValue(true);
		const fetchMock = vi.fn().mockResolvedValue({
			ok: true,
			json: async () => ({ token: { ...token, revokedAt: "2026-01-02T00:00:00Z" } }),
		});
		vi.stubGlobal("fetch", fetchMock);

		render(<ApiTokenManagerClient initialTokens={[token]} allowedScopes={["read", "health:read"]} />);
		fireEvent.click(screen.getByRole("button", { name: "撤销 CLI" }));

		await waitFor(() => expect(fetchMock).toHaveBeenCalledWith("/api/api-tokens?id=tok_1", expect.objectContaining({
			method: "DELETE",
		})));
		expect(await screen.findByText("已撤销")).toBeInTheDocument();
	});
});
