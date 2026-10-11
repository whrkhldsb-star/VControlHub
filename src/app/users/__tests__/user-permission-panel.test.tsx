import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserPermissionPanel } from "../user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const payload = {
	user: {
		id: "user_1",
		username: "alice",
		displayName: "Alice",
		accountType: "customer",
		teamId: "team_a",
		identityTemplateId: "identity:viewer",
		effectivePermissions: ["server:read", "team:read", "user:read"],
		storageAccess: [],
		serverAccess: [],
	},
	identityTemplates: [
		{ id: "identity:viewer", name: "客户只读", isBuiltin: true, permissions: ["server:read"] },
		{ id: "identity:operator", name: "客户运维", isBuiltin: true, permissions: ["server:read", "server:ssh"] },
	],
	customers: [{ id: "team_a", name: "Acme" }, { id: "team_b", name: "Beta" }],
	storageNodes: [],
	servers: [{ id: "srv_1", name: "web-1", operatingSystem: "LINUX", teamId: "team_a" }],
};

function renderPanel() {
	return render(<UserPermissionPanel userId="user_1" username="alice" onClose={() => {}} onSaved={() => {}} />);
}

describe("UserPermissionPanel", () => {
	beforeEach(() => {
		vi.mocked(csrfFetch).mockReset();
		vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PATCH") return { success: true };
			if (String(input).startsWith("/api/users/permissions")) return payload;
			throw new Error(`unexpected request: ${String(input)}`);
		});
	});

	it("shows the account's customer, identity template and server narrowing", async () => {
		renderPanel();
		expect(await screen.findByLabelText("所属客户")).toHaveValue("team_a");
		expect(screen.getByLabelText("身份模板")).toHaveValue("identity:viewer");
		expect(screen.getByText("web-1")).toBeInTheDocument();
	});

	it("saves a changed identity template as an account change", async () => {
		const actor = userEvent.setup();
		renderPanel();
		await actor.selectOptions(await screen.findByLabelText("身份模板"), "identity:operator");
		await actor.click(screen.getByRole("button", { name: "保存权限" }));

		const body = JSON.parse(String(vi.mocked(csrfFetch).mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
		expect(body.account).toEqual({ type: "customer", teamId: "team_a", identityTemplateId: "identity:operator" });
		// Narrowing for the saved customer is still sent with the same save.
		expect(body.serverAccessScopeIds).toEqual(["srv_1"]);
	});

	it("hides narrowing until a moved account's new customer is saved", async () => {
		const actor = userEvent.setup();
		renderPanel();
		await actor.selectOptions(await screen.findByLabelText("所属客户"), "team_b");
		expect(screen.queryByText("web-1")).not.toBeInTheDocument();
		await actor.click(screen.getByRole("button", { name: "保存权限" }));

		const body = JSON.parse(String(vi.mocked(csrfFetch).mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
		expect(body.account).toMatchObject({ type: "customer", teamId: "team_b" });
		expect(body).not.toHaveProperty("serverAccess");
	});

	it("turns an account into a platform administrator without resource narrowing", async () => {
		const actor = userEvent.setup();
		renderPanel();
		await actor.click(await screen.findByRole("button", { name: "平台管理员" }));
		await actor.click(screen.getByRole("button", { name: "保存权限" }));

		const body = JSON.parse(String(vi.mocked(csrfFetch).mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
		expect(body.account).toEqual({ type: "admin" });
		expect(body).not.toHaveProperty("storageAccess");
	});
});
