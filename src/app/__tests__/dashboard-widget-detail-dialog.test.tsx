import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { DashboardWidgetDetailDialog } from "../dashboard-widget-detail-dialog";

vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: () => ({
		t: (key: string) => key,
		locale: "zh" as const,
		setLocale: () => {},
		translations: {},
	}),
}));

function makeWidgetRef() {
	const host = document.createElement("div");
	host.innerHTML = `<section data-dashboard-widget="server-status">VPS Status Content</section>`;
	return { current: host };
}

describe("DashboardWidgetDetailDialog", () => {
	it("renders nothing when openId is null", () => {
		render(
			<DashboardWidgetDetailDialog
				openId={null}
				onClose={vi.fn()}
				widgetRef={{ current: null }}
			/>,
		);
		expect(screen.queryByTestId("dashboard-widget-detail-dialog")).not.toBeInTheDocument();
	});

	it("renders dialog with title and cloned widget content when openId is set", () => {
		const ref = makeWidgetRef();
		render(
			<DashboardWidgetDetailDialog
				openId="server-status"
				onClose={vi.fn()}
				widgetRef={ref as unknown as React.RefObject<HTMLElement | null>}
			/>,
		);
		expect(screen.getByTestId("dashboard-widget-detail-dialog")).toBeInTheDocument();
		expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent("dashboard.widget.serverStatus");
		expect(screen.getByText("VPS Status Content")).toBeInTheDocument();
	});

	it("calls onClose when close button is clicked", () => {
		const onClose = vi.fn();
		const ref = makeWidgetRef();
		render(
			<DashboardWidgetDetailDialog
				openId="server-status"
				onClose={onClose}
				widgetRef={ref as unknown as React.RefObject<HTMLElement | null>}
			/>,
		);
		fireEvent.click(screen.getByRole("button", { name: "dashboard.widget-detail-close" }));
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("calls onClose when ESC is pressed", () => {
		const onClose = vi.fn();
		const ref = makeWidgetRef();
		render(
			<DashboardWidgetDetailDialog
				openId="server-status"
				onClose={onClose}
				widgetRef={ref as unknown as React.RefObject<HTMLElement | null>}
			/>,
		);
		fireEvent.keyDown(window, { key: "Escape" });
		expect(onClose).toHaveBeenCalledTimes(1);
	});

	it("does not render for unknown widget ids (defensive)", () => {
		render(
			<DashboardWidgetDetailDialog
				openId={"not-a-widget" as unknown as "server-status"}
				onClose={vi.fn()}
				widgetRef={{ current: null }}
			/>,
		);
		expect(screen.queryByTestId("dashboard-widget-detail-dialog")).not.toBeInTheDocument();
	});

	it("follows the live widget: opened while it was loading, it shows the data that arrives", async () => {
		// A one-off clone kept showing "loading" after the widget had its chart.
		const ref = makeWidgetRef();
		const widget = ref.current.querySelector("section")!;
		widget.textContent = "Loading analytics";
		render(
			<DashboardWidgetDetailDialog
				openId="server-status"
				onClose={vi.fn()}
				widgetRef={ref as unknown as React.RefObject<HTMLElement | null>}
			/>,
		);
		expect(screen.getByText("Loading analytics")).toBeInTheDocument();
		widget.innerHTML = `<div data-testid="server-analytics-chart">chart</div>`;
		await waitFor(() => expect(screen.getByTestId("server-analytics-chart")).toBeInTheDocument());
		expect(screen.queryByText("Loading analytics")).not.toBeInTheDocument();
	});
});

