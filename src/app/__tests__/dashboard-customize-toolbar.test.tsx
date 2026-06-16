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
				hiddenIds={new Set()}
				onToggleVisibility={onToggleVisibility}
			/>,
		);
		fireEvent.click(screen.getByTestId("toggle-widget-analytics"));
		expect(onToggleVisibility).toHaveBeenCalledWith("analytics");
	});

	it("marks hidden widgets with aria-pressed=true and line-through", () => {
		render(
			<DashboardCustomizeToolbar
				isEditing={true}
				onEnterEdit={vi.fn()}
				onExitEdit={vi.fn()}
				onReset={vi.fn()}
				hiddenIds={new Set(["analytics"])}
				onToggleVisibility={vi.fn()}
			/>,
		);
		const toggle = screen.getByTestId("toggle-widget-analytics");
		expect(toggle).toHaveAttribute("aria-pressed", "true");
		expect(toggle.className).toContain("line-through");
		// Non-hidden widget stays unpressed.
		expect(screen.getByTestId("toggle-widget-server-status")).toHaveAttribute(
			"aria-pressed",
			"false",
		);
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
