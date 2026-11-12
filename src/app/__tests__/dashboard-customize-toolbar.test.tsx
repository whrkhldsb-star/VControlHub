import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { DashboardCustomizeToolbar } from "../dashboard-customize-toolbar";

// Stub the i18n hook so t() returns the key verbatim — tests
// assert on stable testids / roles rather than translated strings.
vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: () => ({
		t: (key: string) => key,
		locale: "zh" as const,
		setLocale: () => {},
		translations: {},
	}),
}));

const ORDER = ["server-status", "quick-links", "analytics", "audit-log"] as const;

describe("DashboardCustomizeToolbar", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("shows only the edit button in view mode", () => {
		render(
			<DashboardCustomizeToolbar
				isEditing={false}
				onEnterEdit={vi.fn()}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				order={ORDER}
				onMove={vi.fn()}
				hiddenIds={new Set()}
				onToggleVisibility={vi.fn()}
			/>,
		);
		expect(screen.getByRole("button", { name: "dashboard.customize-edit" })).toBeInTheDocument();
		expect(screen.queryByText("dashboard.customize-done")).not.toBeInTheDocument();
		expect(screen.queryByText("dashboard.customize-reset")).not.toBeInTheDocument();
	});

	it("calls onEnterEdit when the edit button is clicked", () => {
		const onEnterEdit = vi.fn();
		render(
			<DashboardCustomizeToolbar
				isEditing={false}
				onEnterEdit={onEnterEdit}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				order={ORDER}
				onMove={vi.fn()}
				hiddenIds={new Set()}
				onToggleVisibility={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "dashboard.customize-edit" }));
		expect(onEnterEdit).toHaveBeenCalledTimes(1);
	});

	it("shows toggle + done + reset buttons in edit mode", () => {
		render(
			<DashboardCustomizeToolbar
				isEditing={true}
				onEnterEdit={vi.fn()}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				order={ORDER}
				onMove={vi.fn()}
				hiddenIds={new Set()}
				onToggleVisibility={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("customize-done")).toBeInTheDocument();
		expect(screen.getByRole("button", { name: "dashboard.customize-reset" })).toBeInTheDocument();
		// 4 widgets from DASHBOARD_WIDGET_IDS — each renders a toggle.
		expect(screen.getByTestId("toggle-widget-server-status")).toBeInTheDocument();
		expect(screen.getByTestId("toggle-widget-quick-links")).toBeInTheDocument();
		expect(screen.getByTestId("toggle-widget-analytics")).toBeInTheDocument();
		expect(screen.getByTestId("toggle-widget-audit-log")).toBeInTheDocument();
	});

	it("emits onToggleVisibility with the right widget id when a toggle is clicked", () => {
		const onToggleVisibility = vi.fn();
		render(
			<DashboardCustomizeToolbar
				isEditing={true}
				onEnterEdit={vi.fn()}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				order={ORDER}
				onMove={vi.fn()}
				hiddenIds={new Set()}
				onToggleVisibility={onToggleVisibility}
			/>,
		);
		fireEvent.click(screen.getByTestId("toggle-widget-analytics"));
		expect(onToggleVisibility).toHaveBeenCalledWith("analytics");
	});

	it("turns the switch of a hidden widget off and leaves the others on", () => {
		render(
			<DashboardCustomizeToolbar
				isEditing={true}
				onEnterEdit={vi.fn()}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				order={ORDER}
				onMove={vi.fn()}
				hiddenIds={new Set(["analytics"])}
				onToggleVisibility={vi.fn()}
			/>,
		);
		expect(screen.getByTestId("toggle-widget-analytics")).toHaveAttribute("aria-checked", "false");
		expect(screen.getByTestId("toggle-widget-server-status")).toHaveAttribute("aria-checked", "true");
	});

	it("lists the widgets in the order given and reports a move by one place", () => {
		const onMove = vi.fn();
		render(
			<DashboardCustomizeToolbar
				isEditing={true}
				onEnterEdit={vi.fn()}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				order={["audit-log", "server-status", "quick-links", "analytics"]}
				onMove={onMove}
				hiddenIds={new Set()}
				onToggleVisibility={vi.fn()}
			/>,
		);
		expect(screen.getAllByRole("listitem").map((row) => row.getAttribute("data-widget-row"))).toEqual(["audit-log", "server-status", "quick-links", "analytics"]);
		expect(screen.getByTestId("move-up-audit-log")).toBeDisabled();
		expect(screen.getByTestId("move-down-analytics")).toBeDisabled();
		fireEvent.click(screen.getByTestId("move-down-audit-log"));
		expect(onMove).toHaveBeenCalledWith("audit-log", 1);
		fireEvent.click(screen.getByTestId("move-up-quick-links"));
		expect(onMove).toHaveBeenCalledWith("quick-links", -1);
	});

	it("emits onReset and onExitEdit when the corresponding buttons are clicked", () => {
		const onReset = vi.fn();
		const onExitEdit = vi.fn();
		render(
			<DashboardCustomizeToolbar
				isEditing={true}
				onEnterEdit={vi.fn()}
				onExitEdit={onExitEdit}
				onReset={onReset}
				order={ORDER}
				onMove={vi.fn()}
				hiddenIds={new Set()}
				onToggleVisibility={vi.fn()}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "dashboard.customize-reset" }));
		expect(onReset).toHaveBeenCalledTimes(1);
		fireEvent.click(screen.getByTestId("customize-done"));
		expect(onExitEdit).toHaveBeenCalledTimes(1);
	});
});
