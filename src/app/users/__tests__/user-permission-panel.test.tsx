import { screen, waitFor } from "@testing-library/react";
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
		// The account as the server holds it: a save changes it, and the panel reads it again afterwards.
		let account = { teamId: payload.user.teamId, identityTemplateId: payload.user.identityTemplateId };
		vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PATCH") {
				const saved = JSON.parse(String(init.body)).account as { teamId?: string; identityTemplateId?: string } | undefined;
				if (saved?.teamId && saved.identityTemplateId) account = { teamId: saved.teamId, identityTemplateId: saved.identityTemplateId };
				return { success: true };
			}
			if (String(input).startsWith("/api/users/permissions")) return { ...payload, user: { ...payload.user, ...account } };
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

	it("sends the change back to the original template too: what was saved is the baseline", async () => {
		// The panel compared with what it first loaded, so after saving a change, changing it back counted as "no
		// change", sent no account, and still answered "saved": a demotion silently not applied.
		const actor = userEvent.setup();
		renderPanel();
		const template = await screen.findByLabelText("身份模板");
		await actor.selectOptions(template, "identity:operator");
		await actor.click(screen.getByRole("button", { name: "保存权限" }));
		await screen.findByText("权限配置已保存");
		await waitFor(() => expect(screen.getByLabelText("身份模板")).toHaveValue("identity:operator"));
		await actor.selectOptions(screen.getByLabelText("身份模板"), "identity:viewer");
		await actor.click(screen.getByRole("button", { name: "保存权限" }));

		const patches = vi.mocked(csrfFetch).mock.calls.filter(([, init]) => init?.method === "PATCH").map(([, init]) => JSON.parse(String(init?.body)));
		expect(patches).toHaveLength(2);
		expect(patches[1].account).toEqual({ type: "customer", teamId: "team_a", identityTemplateId: "identity:viewer" });
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

	it("stops saying it is loading once the permissions could not be read", async () => {
		// The reason was shown above a spinner that never stopped.
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("缺少权限: user:manage"));
		renderPanel();
		expect(await screen.findByText("缺少权限: user:manage")).toBeInTheDocument();
		expect(screen.queryByText("正在加载权限配置...")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "保存权限" })).not.toBeInTheDocument();
	});

	it("shows the new customer's servers after the account was moved, not the old one's", async () => {
		// Saving a move made the narrowing editable again over the list first loaded: the servers of the customer
		// the account had just left, with their ids as the scope of the next save.
		const actor = userEvent.setup();
		let moved = false;
		vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
			if (init?.method === "PATCH") { moved = true; return { success: true }; }
			if (!String(input).startsWith("/api/users/permissions")) throw new Error(`unexpected request: ${String(input)}`);
			return moved
				? { ...payload, user: { ...payload.user, teamId: "team_b" }, servers: [{ id: "srv_9", name: "beta-db", operatingSystem: "LINUX", teamId: "team_b" }] }
				: payload;
		});
		renderPanel();
		await actor.selectOptions(await screen.findByLabelText("所属客户"), "team_b");
		await actor.click(screen.getByRole("button", { name: "保存权限" }));

		expect(await screen.findByText("beta-db")).toBeInTheDocument();
		expect(screen.queryByText("web-1")).not.toBeInTheDocument();
		// Said where it is seen: the dialog is long and its message was at the very top.
		expect(await screen.findByRole("status")).toHaveTextContent("权限配置已保存");
	});
});
