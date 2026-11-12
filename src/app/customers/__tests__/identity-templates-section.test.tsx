import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.fetch }));

import { IdentityTemplatesSection } from "../identity-templates-section";

const template = { id: "tpl_1", name: "值班运维", description: null, permissions: ["server:view"], isBuiltin: false, _count: { members: 0 } };

describe("IdentityTemplatesSection", () => {
	beforeEach(() => {
		mocks.fetch.mockReset();
	});

	it("says why a template could not be deleted in the dialog that asked", async () => {
		// The reason was put on the page, behind the dialog, which just stopped being busy.
		const user = userEvent.setup();
		mocks.fetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === "DELETE") throw new Error("该模板仍被 2 名成员使用");
			return { templates: [template] };
		});
		render(<IdentityTemplatesSection />);
		await user.click(await screen.findByRole("button", { name: "删除" }));
		const dialog = screen.getByRole("dialog", { name: "删除身份模板" });
		await user.click(within(dialog).getByRole("button", { name: "删除" }));

		expect(await within(dialog).findByText("该模板仍被 2 名成员使用")).toBeVisible();
		expect(screen.getAllByText("该模板仍被 2 名成员使用")).toHaveLength(1);
		expect(within(dialog).getByRole("button", { name: "删除" })).toBeEnabled();

		// Given up: nothing of it stays on the page, nor shows in the next question.
		await user.click(within(dialog).getByRole("button", { name: "取消" }));
		expect(screen.queryByText("该模板仍被 2 名成员使用")).toBeNull();
		await user.click(screen.getByRole("button", { name: "删除" }));
		expect(within(screen.getByRole("dialog", { name: "删除身份模板" })).queryByText("该模板仍被 2 名成员使用")).toBeNull();
	});

	it("removes the template from the list once it is deleted", async () => {
		const user = userEvent.setup();
		let deleted = false;
		mocks.fetch.mockImplementation(async (_url: string, init?: { method?: string }) => {
			if (init?.method === "DELETE") { deleted = true; return {}; }
			return { templates: deleted ? [] : [template] };
		});
		render(<IdentityTemplatesSection />);
		await user.click(await screen.findByRole("button", { name: "删除" }));
		await user.click(within(screen.getByRole("dialog", { name: "删除身份模板" })).getByRole("button", { name: "删除" }));

		expect(mocks.fetch).toHaveBeenCalledWith("/api/identity-templates/tpl_1", { method: "DELETE" });
		await waitFor(() => expect(screen.queryByText("值班运维")).toBeNull());
		expect(screen.queryByRole("dialog", { name: "删除身份模板" })).toBeNull();
	});
});
