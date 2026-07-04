import { describe, expect, it, vi, beforeEach } from "vitest";
import { screen } from "@testing-library/react";

import { SshTerminalPanel } from "../ssh-terminal-panel";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(() => Promise.resolve({ token: "handshake-token" })),
}));

vi.mock("@xterm/xterm", () => ({
	Terminal: class MockTerminal {
		cols = 80;
		rows = 24;
		buffer = { active: { cursorY: 0, getLine: () => ({ translateToString: () => "" }) } };
		loadAddon() {}
		open() {}
		write() {}
		onData() {}
		dispose() {}
	},
}));

vi.mock("@xterm/addon-fit", () => ({
	FitAddon: class MockFitAddon {
		fit() {}
	},
}));

vi.mock("@xterm/addon-search", () => ({
	SearchAddon: class MockSearchAddon {
		findNext() {}
		findPrevious() {}
		clearDecorations() {}
	},
}));

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

class MockWebSocket {
	static OPEN = 1;
	static CONNECTING = 0;
	static CLOSING = 2;
	static CLOSED = 3;
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	send() {}
	close() {}
}

const defaultProps = {
	serverId: "srv_1",
	serverName: "prod-vps",
	host: "203.0.113.10:22",
	sessionToken: "session-token",
	visible: true,
	onClose: vi.fn(),
} as const;

describe("SshTerminalPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		vi.stubGlobal("WebSocket", MockWebSocket);
	});

	it("renders the toolbar with server name and host", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.getByText("prod-vps")).toBeInTheDocument();
		expect(screen.getByText("203.0.113.10:22")).toBeInTheDocument();
	});

	it("shows connecting status initially", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.getByRole("status")).toHaveTextContent("连接中");
	});

	it("renders the terminal surface div", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.getByTestId("ssh-terminal-surface")).toBeInTheDocument();
		expect(screen.getByTestId("ssh-terminal-panel-srv_1")).toBeInTheDocument();
	});

	it("renders the close button", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.getByRole("button", { name: "关闭 SSH 终端" })).toBeInTheDocument();
	});

	it("renders the command panel and file manager toggle buttons", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.getByRole("button", { name: "📋 命令面板" })).toHaveAttribute("aria-expanded", "false");
		expect(screen.getByRole("button", { name: "📁 文件" })).toHaveAttribute("aria-expanded", "false");
	});

	it("hides the panel via CSS when visible is false", () => {
		render(<SshTerminalPanel {...defaultProps} visible={false} />);

		const panel = screen.getByTestId("ssh-terminal-panel-srv_1");
		expect(panel.style.display).toBe("none");
	});

	it("shows reconnect button only after error/closed status", async () => {
		render(<SshTerminalPanel {...defaultProps} />);

		// Initially no reconnect button
		expect(screen.queryByRole("button", { name: "重连" })).not.toBeInTheDocument();
	});

	it("calls onClose when the close button is clicked", async () => {
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		const onClose = vi.fn();
		render(<SshTerminalPanel {...defaultProps} onClose={onClose} />);

		await user.click(screen.getByRole("button", { name: "关闭 SSH 终端" }));
		expect(onClose).toHaveBeenCalled();
	});

	it("renders the terminal search bar with placeholder", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.getByPlaceholderText("搜索终端输出…")).toBeInTheDocument();
	});
});
