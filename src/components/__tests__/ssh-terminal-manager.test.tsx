/** @vitest-environment jsdom */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

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
	}) => {
		// Track mounts via module-level side effect in render (strict-mode may double).
		// We care that minimize does not unmount: serverId stays present in DOM.
		return (
			<div
				data-testid={`mock-panel-${props.serverId}`}
				data-visible={props.visible ? "1" : "0"}
			>
				panel-{props.serverId}
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
		sessionToken: "tok",
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
});
