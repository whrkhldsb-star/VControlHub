import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { SshTerminalPanel } from "../ssh-terminal-panel";
import { encodeBase64 } from "../ssh-terminal-codec";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { Terminal } from "@xterm/xterm";

type MockTerm = {
	scrollLines: ReturnType<typeof vi.fn>;
	buffer: { normal: { viewportY: number; length: number } };
};
function terminalInstances(): MockTerm[] {
	return (Terminal as unknown as { instances: MockTerm[] }).instances;
}

/** jsdom has no TouchEvent — dispatch a plain cancelable Event with a touches list. */
function fireTouch(element: HTMLElement, type: "touchstart" | "touchmove", clientY: number) {
	const event = new Event(type, { cancelable: true, bubbles: true });
	Object.defineProperty(event, "touches", { value: [{ clientY }] });
	element.dispatchEvent(event);
	return event;
}

vi.mock("@/lib/auth/csrf-client", () => ({
	csrfFetch: vi.fn(() => Promise.resolve({ token: "handshake-token" })),
}));

vi.mock("@xterm/xterm", () => ({
	Terminal: class MockTerminal {
		static instances: MockTerminal[] = [];
		cols = 80;
		rows = 24;
		buffer = {
			active: { cursorY: 0, getLine: () => ({ translateToString: () => "" }) },
			normal: { viewportY: 10, length: 100 },
		};
		scrollLines = vi.fn();
		loadAddon() {}
		open() {}
		write() {}
		onData() {}
		dispose() {}
		constructor() {
			MockTerminal.instances.push(this);
		}
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
	static instances: MockWebSocket[] = [];
	readyState = 0;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor() {
		MockWebSocket.instances.push(this);
	}
	send() {}
	close() {}
}

const defaultProps = {
	serverId: "srv_1",
	serverName: "prod-vps",
	host: "203.0.113.10:22",
	visible: true,
	onClose: vi.fn(),
} as const;

describe("SshTerminalPanel", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		MockWebSocket.instances = [];
		terminalInstances().length = 0;
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

	it("waits for the SSH proxy handshake before reporting connected", async () => {
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		const socket = MockWebSocket.instances[0]!;

		act(() => {
			socket.readyState = MockWebSocket.OPEN;
			socket.onopen?.();
		});
		expect(screen.getByRole("status")).toHaveTextContent("连接中");

		act(() => {
			socket.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
		});
		expect(screen.getByRole("status")).toHaveTextContent("已连接");
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

		expect(screen.getByRole("button", { name: "命令面板" })).toHaveAttribute("aria-expanded", "false");
		expect(screen.getByRole("button", { name: "文件" })).toHaveAttribute("aria-expanded", "false");
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

	it("translates finger drags into scrollLines so mobile users can reach the scrollback", async () => {
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(terminalInstances()).toHaveLength(1));
		const term = terminalInstances()[0]!;
		const surface = screen.getByTestId("ssh-terminal-surface");

		fireTouch(surface, "touchstart", 300);
		const move = fireTouch(surface, "touchmove", 350); // finger down 50px → older lines
		expect(move.defaultPrevented).toBe(true);
		// No .xterm-screen in jsdom → 16px fallback cell height: 50/16 → 3 lines up.
		expect(term.scrollLines).toHaveBeenCalledWith(-3);

		fireTouch(surface, "touchmove", 330); // finger up 20px → back toward newer lines
		expect(term.scrollLines).toHaveBeenCalledWith(1);
	});

	it("releases the gesture at scrollback edges so the surrounding panel scrolls", async () => {
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(terminalInstances()).toHaveLength(1));
		const term = terminalInstances()[0]!;
		const surface = screen.getByTestId("ssh-terminal-surface");

		// Pinned at the top of scrollback: dragging down (older) has nowhere to go.
		term.buffer.normal.viewportY = 0;
		fireTouch(surface, "touchstart", 300);
		let move = fireTouch(surface, "touchmove", 360);
		expect(move.defaultPrevented).toBe(false);
		expect(term.scrollLines).not.toHaveBeenCalled();

		// Pinned at the bottom: dragging up (newer) has nowhere to go either.
		term.buffer.normal.viewportY = 76; // + rows(24) === length(100)
		fireTouch(surface, "touchstart", 300);
		move = fireTouch(surface, "touchmove", 250);
		expect(move.defaultPrevented).toBe(false);
		expect(term.scrollLines).not.toHaveBeenCalled();
	});

	it("sends raw key sequences from the quick keys palette without appending Enter", async () => {
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await user.click(screen.getByRole("button", { name: "命令面板" }));
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		const socket = MockWebSocket.instances[0]!;
		const send = vi.spyOn(socket, "send");
		act(() => {
			socket.readyState = MockWebSocket.OPEN;
		});

		await user.click(screen.getByRole("button", { name: "Ctrl+C" }));
		expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: encodeBase64("\u0003") }));

		await user.click(screen.getByRole("button", { name: "↑" }));
		expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: encodeBase64("\u001b[A") }));

		// Raw keys must never carry a trailing Enter like quick commands do.
		const sendCalls = send.mock.calls as unknown as [string][];
		for (const call of sendCalls) {
			expect(String(call[0])).not.toContain(encodeBase64("\r"));
		}
	});

	it("composes a custom preset (Shift+Tab) in the builder, persists and sends it", async () => {
		window.localStorage.clear();
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await user.click(screen.getByRole("button", { name: "命令面板" }));
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));

		// Open the builder, enable Shift, pick Tab, add.
		await user.click(screen.getByRole("button", { name: /自定义组合键/ }));
		await user.click(screen.getByRole("button", { name: "Shift" }));
		await user.selectOptions(screen.getByRole("combobox", { name: "选择按键" }), "tab");
		expect(screen.getByTestId("quick-key-preview").textContent).toBe("Shift+Tab");
		await user.click(screen.getByRole("button", { name: "添加" }));

		// Preset persisted and the palette now renders the custom button.
		const stored = JSON.parse(window.localStorage.getItem("ssh-quick-key-presets") ?? "[]");
		expect(stored).toEqual([
			{ label: "Shift+Tab", sequence: { keyId: "tab", modifiers: ["shift"] } },
		]);

		const socket = MockWebSocket.instances[0]!;
		const send = vi.spyOn(socket, "send");
		act(() => {
			socket.readyState = MockWebSocket.OPEN;
		});
		await user.click(screen.getByRole("button", { name: "Shift+Tab" }));
		expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: encodeBase64("\u001b[Z") }));
	});
});
