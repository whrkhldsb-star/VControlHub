/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@/lib/i18n/use-locale", () => ({
	useI18n: () => ({
		t: (key: string) => key,
		locale: "zh" as const,
	}),
}));

const panelMountLog: string[] = [];

vi.mock("@/components/ssh-terminal-panel", () => ({
	SshTerminalPanel: (props: {
		serverId: string;
		visible: boolean;
		fullscreen?: boolean;
		onToggleFullscreen?: () => void;
	}) => {
		// Track mounts via module-level side effect in render (strict-mode may double).
		// We care that minimize does not unmount: serverId stays present in DOM.
		return (
			<div
				data-testid={`mock-panel-${props.serverId}`}
				data-visible={props.visible ? "1" : "0"}
				data-fullscreen={props.fullscreen ? "1" : "0"}
			>
				panel-{props.serverId}
				<button type="button" onClick={props.onToggleFullscreen} data-testid={`mock-fullscreen-${props.serverId}`}>
					fullscreen
				</button>
			</div>
		);
	},
}));

import { SshTerminalManager, type SshTerminalTab } from "../ssh-terminal-manager";

const tabs: SshTerminalTab[] = [
	{
		id: "srv1-1",
		serverId: "srv1",
		serverName: "Alpha",
		host: "1.1.1.1",
		status: "connected",
	},
];

describe("SshTerminalManager minimize keeps sessions mounted", () => {
	beforeEach(() => {
		panelMountLog.length = 0;
	});

	it("keeps SshTerminalPanel mounted after minimize and restore", () => {
		render(
			<SshTerminalManager
				tabs={tabs}
				activeTabIndex={0}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onClose={vi.fn()}
				onStatusChange={vi.fn()}
			/>,
		);

		expect(screen.getByTestId("mock-panel-srv1")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("ssh-terminal-minimize"));
		// Pill appears; panel must still be in document (connection alive)
		expect(screen.getByTestId("ssh-terminal-minimized-pill")).toBeInTheDocument();
		expect(screen.getByTestId("mock-panel-srv1")).toBeInTheDocument();
		expect(screen.getByTestId("mock-panel-srv1").getAttribute("data-visible")).toBe("0");

		fireEvent.click(screen.getByTestId("ssh-terminal-minimized-pill"));
		expect(screen.getByTestId("mock-panel-srv1")).toBeInTheDocument();
		expect(screen.getByTestId("mock-panel-srv1").getAttribute("data-visible")).toBe("1");
	});

	it("renders a mobile resize handle without unmounting the terminal", () => {
		render(
			<SshTerminalManager
				tabs={tabs}
				activeTabIndex={0}
				onTabSelect={vi.fn()}
				onTabClose={vi.fn()}
				onClose={vi.fn()}
				onStatusChange={vi.fn()}
			/>,
		);

		const manager = screen.getByRole("region");
		expect(manager).toHaveAttribute("data-mobile-fullscreen", "true");
		expect(screen.getByTestId("ssh-terminal-mobile-resize-handle")).toBeInTheDocument();
		expect(screen.getByTestId("mock-panel-srv1")).toBeInTheDocument();
	});
});

describe("SshTerminalManager full screen", () => {
	const renderManager = (onTabClose = vi.fn()) => {
		render(
			<SshTerminalManager
				tabs={tabs}
				activeTabIndex={0}
				onTabSelect={vi.fn()}
				onTabClose={onTabClose}
				onClose={vi.fn()}
				onStatusChange={vi.fn()}
			/>,
		);
		return { onTabClose };
	};

	let fullscreenElement: Element | null = null;
	const requestFullscreen = vi.fn(() => {
		fullscreenElement = document.documentElement;
		return Promise.resolve();
	});
	const exitFullscreen = vi.fn(() => {
		fullscreenElement = null;
		return Promise.resolve();
	});

	beforeEach(() => {
		fullscreenElement = null;
		requestFullscreen.mockClear();
		exitFullscreen.mockClear();
		Object.defineProperty(document, "fullscreenElement", { configurable: true, get: () => fullscreenElement });
		Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: requestFullscreen });
		Object.defineProperty(document, "exitFullscreen", { configurable: true, value: exitFullscreen });
	});

	it("gives the active terminal the whole viewport and hides the title and tab bars", async () => {
		renderManager();
		const region = screen.getByRole("region");
		expect(screen.getByRole("tablist")).toBeInTheDocument();

		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));

		expect(region.parentElement).toHaveAttribute("data-fullscreen", "true");
		expect(screen.getByTestId("mock-panel-srv1")).toHaveAttribute("data-fullscreen", "1");
		expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
		expect(screen.queryByTestId("ssh-terminal-minimize")).not.toBeInTheDocument();
		await vi.waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));

		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));
		expect(region.parentElement).not.toHaveAttribute("data-fullscreen");
		expect(screen.getByRole("tablist")).toBeInTheDocument();
		expect(exitFullscreen).toHaveBeenCalledTimes(1);
	});

	it("keeps a compact session strip in full screen when several sessions are open", () => {
		// Full screen hid the tab bar with the title bar, and there was no other
		// way to switch sessions: browsers keep Ctrl+Tab for their own tabs.
		const onTabSelect = vi.fn();
		const two: SshTerminalTab[] = [...tabs, { id: "srv2-1", serverId: "srv2", serverName: "Beta", host: "2.2.2.2", status: "connected" }];
		render(
			<SshTerminalManager tabs={two} activeTabIndex={0} onTabSelect={onTabSelect} onTabClose={vi.fn()} onClose={vi.fn()} onStatusChange={vi.fn()} />,
		);
		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));
		expect(screen.getByRole("region").parentElement).toHaveAttribute("data-fullscreen", "true");
		expect(screen.queryByTestId("ssh-terminal-minimize")).not.toBeInTheDocument();
		const strip = screen.getByTestId("ssh-terminal-fullscreen-tabs");
		expect(strip).toHaveAttribute("role", "tablist");
		fireEvent.click(within(strip).getByText("Beta"));
		expect(onTabSelect).toHaveBeenCalledWith(1);
	});

	it("stays usable where the browser has no Fullscreen API (iOS Safari)", () => {
		Object.defineProperty(document.documentElement, "requestFullscreen", { configurable: true, value: undefined });
		renderManager();

		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));
		expect(screen.getByRole("region").parentElement).toHaveAttribute("data-fullscreen", "true");

		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));
		expect(screen.getByRole("region").parentElement).not.toHaveAttribute("data-fullscreen");
		expect(exitFullscreen).not.toHaveBeenCalled();
	});

	it("leaves full screen when the browser leaves it on its own (Esc, back gesture)", async () => {
		renderManager();
		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));
		await vi.waitFor(() => expect(requestFullscreen).toHaveBeenCalledTimes(1));

		fullscreenElement = null;
		fireEvent(document, new Event("fullscreenchange"));

		expect(screen.getByRole("region").parentElement).not.toHaveAttribute("data-fullscreen");
		expect(screen.getByRole("tablist")).toBeInTheDocument();
	});

	it("makes Escape leave full screen before it closes the tab", () => {
		const { onTabClose } = renderManager();
		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));

		fireEvent.keyDown(window, { key: "Escape" });
		expect(screen.getByRole("region").parentElement).not.toHaveAttribute("data-fullscreen");
		expect(onTabClose).not.toHaveBeenCalled();

		fireEvent.keyDown(window, { key: "Escape" });
		expect(onTabClose).toHaveBeenCalledWith(0);
	});

	it("keeps the minimized pill in its corner while full screen is on", () => {
		renderManager();
		fireEvent.click(screen.getByTestId("mock-fullscreen-srv1"));
		fireEvent.keyDown(window, { key: "m", ctrlKey: true });

		expect(screen.getByTestId("ssh-terminal-minimized-pill")).toBeInTheDocument();
		expect(screen.getByTestId("ssh-terminal-minimized-pill").parentElement).not.toHaveAttribute("data-fullscreen");

		fireEvent.click(screen.getByTestId("ssh-terminal-minimized-pill"));
		expect(screen.getByRole("region").parentElement).toHaveAttribute("data-fullscreen", "true");
	});
});
