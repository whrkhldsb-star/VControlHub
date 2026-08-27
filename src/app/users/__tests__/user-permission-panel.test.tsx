import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { UserPermissionPanel } from "../user-permission-panel";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(),
}));

const permissionsPayload = {
	user: {
		id: "user_1",
		username: "alice",
		displayName: "Alice",
		roles: [{ key: "viewer", name: "观察者" }],
		effectivePermissions: ["storage:read"],
		directPermissionKeys: [],
		storageAccess: [],
	},
	roles: [{ key: "viewer", name: "观察者" }],
	permissions: [{ key: "storage:read", name: "读云盘" }],
	storageNodes: [],
};

function template(overrides: Record<string, unknown> = {}) {
	return {
		id: "tpl_1",
		name: "运维岗",
		description: null,
		roleKeys: ["viewer"],
		permissions: ["storage:read"],
		storageAccess: [],
		isBuiltin: false,
		...overrides,
	};
}

/** The panel loads permissions first, then the role-template roster. */
function mockLoad(templates: Array<Record<string, unknown>>) {
	vi.mocked(csrfFetch).mockImplementation(async (input: RequestInfo | URL) => {
		const url = String(input);
		if (url.startsWith("/api/users/permissions")) return permissionsPayload;
		if (url === "/api/role-templates") return { templates };
		throw new Error(`unexpected request: ${url}`);
	});
}

function renderPanel() {
	return render(
		<UserPermissionPanel userId="user_1" username="alice" onClose={() => {}} onSaved={() => {}} />,
	);
}

describe("UserPermissionPanel role templates", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("deletes a custom template after an inline confirmation", async () => {
		const actor = userEvent.setup();
		mockLoad([template()]);
		renderPanel();

		await actor.selectOptions(await screen.findByLabelText("选择岗位模板"), "tpl_1");
		await actor.click(screen.getByRole("button", { name: "删除模板" }));
		// One click must not delete: the destructive step needs a second confirmation.
		expect(vi.mocked(csrfFetch)).not.toHaveBeenCalledWith(
			"/api/role-templates/tpl_1",
			expect.anything(),
		);

		vi.mocked(csrfFetch).mockResolvedValueOnce({ success: true });
		await actor.click(screen.getByRole("button", { name: "确认删除" }));

		expect(vi.mocked(csrfFetch)).toHaveBeenCalledWith("/api/role-templates/tpl_1", {
			method: "DELETE",
		});
		expect(await screen.findByText("岗位模板已删除")).toBeInTheDocument();
		expect(screen.queryByRole("option", { name: "运维岗" })).not.toBeInTheDocument();
	});

	it("keeps the template when the delete request fails", async () => {
		const actor = userEvent.setup();
		mockLoad([template()]);
		renderPanel();

		await actor.selectOptions(await screen.findByLabelText("选择岗位模板"), "tpl_1");
		await actor.click(screen.getByRole("button", { name: "删除模板" }));
		vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("内置模板不可删除"));
		await actor.click(screen.getByRole("button", { name: "确认删除" }));

		expect(await screen.findByText("内置模板不可删除")).toBeInTheDocument();
		expect(screen.getByRole("option", { name: "运维岗" })).toBeInTheDocument();
	});

	it("offers no delete affordance for a built-in template", async () => {
		const actor = userEvent.setup();
		mockLoad([template({ id: "tpl_builtin", name: "内置只读", isBuiltin: true })]);
		renderPanel();

		await actor.selectOptions(await screen.findByLabelText("选择岗位模板"), "tpl_builtin");
		expect(screen.queryByRole("button", { name: "删除模板" })).not.toBeInTheDocument();
	});
});
