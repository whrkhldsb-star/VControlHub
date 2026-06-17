import { fireEvent, screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { describe, expect, it, vi } from "vitest";

import { CommandCreateForm } from "../command-create-form";

vi.mock("react", async () => {
	const actual = await vi.importActual<typeof import("react")>("react");
	return {
		...actual,
		useActionState: () => [{}, vi.fn()] };
});

describe("CommandCreateForm", () => {
	const servers = [
		{ id: "srv_1", name: "hk-prod-1", host: "203.0.113.10", enabled: true },
		{ id: "srv_2", name: "hk-prod-2", host: "203.0.113.11", enabled: false },
	];

	it("renders server list with enabled/disabled states and supports toggle-all", () => {
		const { container } = render(<CommandCreateForm servers={servers} />);

		// Initially no servers selected, checkbox for srv_1 is unchecked
		expect(container.querySelectorAll('input[type="checkbox"][name="serverIds"]').length).toBe(2);
		expect(container.querySelector('input[type="checkbox"][name="serverIds"][value="srv_1"]')).not.toBeNull();
		expect(container.querySelector('input[type="checkbox"][name="serverIds"][value="srv_2"]')).not.toBeNull();

		// Toggle-all button says "全选启用节点"
		expect(screen.getByRole("button", { name: "全选启用节点" })).toBeInTheDocument();

		// Click toggle-all selects all enabled servers
		fireEvent.click(screen.getByRole("button", { name: /全选启用节点/ }));

		// After clicking, button says "取消全选"
		expect(screen.getByRole("button", { name: "取消全选" })).toBeInTheDocument();
	});
});
