import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserPermissionPanel } from "../user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const payload = {
	version: "first-version",
	nextCursor: { servers: null, storageNodes: null, identityTemplates: null },
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
				return { success: true, version: "saved-version" };
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

	it("keeps assigned resources and edits across pages, searches and exact ID lookups", async () => {
		const actor = userEvent.setup();
		const pinnedServer = { ...payload.servers[0]!, id: "srv_99", name: "assigned-web" };
		const pinnedNode = { id: "node_99", name: "Assigned disk", driver: "LOCAL", basePath: "/data" };
		const template = { id: "tpl_99", name: "Assigned template", isBuiltin: false, permissions: ["server:read"] };
		const storageGrant = { storageNode: pinnedNode, storageNodeId: pinnedNode.id, pathPrefix: "one",
			canRead: true, canWrite: false, canDelete: false, quotaBytes: null, maxFileBytes: null };
		const serverGrant = { serverId: pinnedServer.id, server: pinnedServer, canRead: true,
			canManage: false, canConnect: false, canFileRead: false, canFileWrite: false, canFileDelete: false };
		const first = { ...payload, user: { ...payload.user, identityTemplateId: template.id,
			storageAccess: [storageGrant], serverAccess: [serverGrant] },
			nextCursor: { ...payload.nextCursor, servers: "srv_1" } };
		const pages = { ...payload, version: "a-later-read", servers: [], storageNodes: [], identityTemplates: [] };
		const reads: URLSearchParams[] = [];
		const patches: Record<string, unknown>[] = [];
		vi.mocked(csrfFetch).mockImplementation(async (input, init) => {
			if (init?.method === "PATCH") {
				patches.push(JSON.parse(String(init.body)));
				if (patches.length === 1) throw new Error("Edit conflict");
				return { success: true, version: "saved-version" };
			}
			const params = new URL(String(input), "https://test.invalid").searchParams;
			reads.push(params);
			if (params.has("includeAssigned")) return first;
			if (params.get("id") === template.id) return { ...pages, identityTemplates: [template] };
			if (params.has("serverAfter")) return { ...pages, servers: [{ ...pinnedServer, id: "srv_2", name: "page-two" }] };
			if (params.get("search") === "worker") return { ...pages, servers: [{ ...pinnedServer, id: "srv_3", name: "worker" }] };
			if (params.get("id") === "node_42") return { ...pages, storageNodes: [{ ...pinnedNode, id: "node_42", name: "Exact disk" }] };
			throw new Error("Unexpected option request");
		});
		renderPanel();

		expect(await screen.findByText("assigned-web")).toBeInTheDocument();
		expect(screen.getByRole("combobox", { name: "身份模板" })).toHaveValue(template.id);
		expect(screen.getByRole("combobox", { name: "存储节点" })).toHaveValue(pinnedNode.id);
		expect(reads.map(params => params.get("pageSize"))).toEqual(["25", "1"]);
		const serverSearch = within(screen.getByRole("form", { name: "查找服务器权限" }));
		await actor.click(serverSearch.getByRole("button", { name: "下一页" }));
		expect(await screen.findByText("page-two")).toBeInTheDocument();
		expect(screen.queryByText("web-1")).not.toBeInTheDocument();
		expect(reads.at(-1)?.get("serverAfter")).toBe("srv_1");
		await actor.click(screen.getByRole("button", { name: "单独设置" }));
		await actor.type(serverSearch.getByRole("searchbox"), "worker");
		await actor.click(serverSearch.getByRole("button", { name: "按名称搜索" }));
		expect(await screen.findByText("worker")).toBeInTheDocument();
		expect(screen.getByText("page-two")).toBeInTheDocument();
		expect(screen.getByText("assigned-web")).toBeInTheDocument();
		expect(reads.at(-1)?.has("serverAfter")).toBe(false);
		const diskSearch = within(screen.getByRole("form", { name: "查找存储节点" }));
		await actor.type(diskSearch.getByRole("searchbox"), "node_42");
		await actor.click(diskSearch.getByRole("button", { name: "按 ID 查找" }));
		const disk = screen.getByRole("combobox", { name: "存储节点" });
		expect(await within(disk).findByRole("option", { name: /Exact disk/ })).toBeInTheDocument();
		expect(disk).toHaveValue(pinnedNode.id);
		await actor.selectOptions(disk, "node_42");

		const save = screen.getByRole("button", { name: "保存权限" });
		await actor.click(save);
		expect(await screen.findByText("Edit conflict")).toBeInTheDocument();
		expect(patches[0]).toEqual({ userId: "user_1", version: "first-version",
			serverAccessScopeIds: ["srv_2"], serverAccess: [{ serverId: "srv_2", canRead: true, canConnect: false, canManage: false,
				canFileRead: false, canFileWrite: false, canFileDelete: false }],
			storageAccessScopeIds: [pinnedNode.id, "node_42"], storageAccess: [{ storageNodeId: "node_42", pathPrefix: "one",
				canRead: true, canWrite: false, canDelete: false, quotaBytes: null, maxFileBytes: null }] });
		await actor.click(save);
		expect(patches[1]).toEqual(patches[0]);
		await actor.click(save);
		expect(patches[2]).toEqual({ userId: "user_1", version: "saved-version" });
	});

	it.each([
		["存储节点", "storageNodes", "storageAfter"], ["身份模板", "identityTemplates", "templateAfter"],
	])("pages %s independently and resets its cursor on a name search", async (label, resource, after) => {
		const actor = userEvent.setup();
		const next = { ...payload, nextCursor: { ...payload.nextCursor, [resource]: "next-id" } };
		const requests: URLSearchParams[] = [];
		vi.mocked(csrfFetch).mockImplementation(async (input) => {
			const params = new URL(String(input), "https://test.invalid").searchParams;
			requests.push(params);
			return params.has(after) ? payload : next;
		});
		renderPanel();
		const picker = within(await screen.findByRole("form", { name: "查找" + label }));
		await actor.click(picker.getByRole("button", { name: "下一页" }));
		expect(requests.at(-1)?.get(after)).toBe("next-id");
		expect(requests.at(-1)?.get("resource")).toBe(resource);
		await actor.click(picker.getByRole("button", { name: "上一页" }));
		expect(requests.at(-1)?.has(after)).toBe(false);
		await actor.type(picker.getByRole("searchbox"), "remote");
		await actor.click(picker.getByRole("button", { name: "按名称搜索" }));
		expect(requests.at(-1)?.get("search")).toBe("remote");
		expect(requests.every(params => params.has("pageSize"))).toBe(true);
	});

	it("can choose a storage search result before adding the first path grant", async () => {
		const actor = userEvent.setup();
		const node = { id: "node_1", name: "Disk 1", driver: "LOCAL", basePath: "/data" };
		vi.mocked(csrfFetch).mockResolvedValueOnce(payload).mockResolvedValueOnce({
			...payload, storageNodes: [node, { ...node, id: "node_2", name: "Disk 2" }],
		});
		renderPanel();
		const picker = within(await screen.findByRole("form", { name: "查找存储节点" }));
		await actor.type(picker.getByRole("searchbox"), "Disk");
		await actor.click(picker.getByRole("button", { name: "按名称搜索" }));
		await actor.selectOptions(screen.getByRole("combobox", { name: "要添加授权的存储节点" }), "node_2");
		await actor.click(screen.getByRole("button", { name: "添加授权" }));
		expect(screen.getByRole("combobox", { name: "存储节点" })).toHaveValue("node_2");
	});

	it("saves a changed identity template as an account change", async () => {
		const actor = userEvent.setup();
		renderPanel();
		await actor.selectOptions(await screen.findByLabelText("身份模板"), "identity:operator");
		await actor.click(screen.getByRole("button", { name: "保存权限" }));

		const body = JSON.parse(String(vi.mocked(csrfFetch).mock.calls.find(([, init]) => init?.method === "PATCH")?.[1]?.body));
		expect(body.account).toEqual({ type: "customer", teamId: "team_a", identityTemplateId: "identity:operator" });
		expect(body.version).toBe("first-version");
		expect(body).not.toHaveProperty("serverAccessScopeIds");
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
			if (init?.method === "PATCH") { moved = true; return { success: true, version: "saved-version" }; }
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
