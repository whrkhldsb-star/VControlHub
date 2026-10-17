import { describe, expect, it, vi, beforeEach } from "vitest";
import { act, screen, waitFor } from "@testing-library/react";

import { SshTerminalPanel } from "../ssh-terminal-panel";
import { encodeBase64 } from "../ssh-terminal-codec";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { Terminal } from "@xterm/xterm";

type MockTerm = {
	keyHandler?: (event: KeyboardEvent) => boolean;
	selection: string;
	scrollLines: ReturnType<typeof vi.fn>;
	buffer: { active: { viewportY: number; length: number } };
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
			active: { type: "normal", cursorY: 0, viewportY: 10, length: 100, getLine: () => ({ translateToString: () => "" }) },
		};
		modes = { mouseTrackingMode: "none" };
		options: { fontSize?: number } = {};
		scrollLines = vi.fn();
		constructor(options: { fontSize?: number } = {}) {
			this.options = { ...options };
			MockTerminal.instances.push(this);
		}
		loadAddon() {}
		textarea = document.createElement("textarea");
		open(parent: HTMLElement) { parent.appendChild(this.textarea); }
		input() {}
		keyHandler?: (event: KeyboardEvent) => boolean;
		selection = "";
		attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean) { this.keyHandler = handler; }
		hasSelection() { return this.selection.length > 0; }
		getSelection() { return this.selection; }
		clearSelection() {}
		write() {}
		focus() {}
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
	static instances: MockWebSocket[] = [];
	readyState = 0;
	url: string;
	onopen: (() => void) | null = null;
	onmessage: ((event: { data: string }) => void) | null = null;
	onclose: (() => void) | null = null;
	onerror: (() => void) | null = null;
	constructor(url: string) {
		this.url = url;
		MockWebSocket.instances.push(this);
	}
	send() {}
	close() {}
}

function connectSocket(socket: MockWebSocket, session?: { resumeId: string | null; resumed: boolean; keepAliveMs: number }) {
	act(() => {
		socket.readyState = MockWebSocket.OPEN;
		socket.onopen?.();
		socket.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
		if (session) socket.onmessage?.({ data: JSON.stringify({ type: "session", ...session }) });
	});
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

	it("shows clipboard failures and clears them on a successful retry", async () => {
		const writeText = vi.fn().mockRejectedValue(new Error("denied"));
		vi.stubGlobal("navigator", { clipboard: { writeText } });
		try {
			render(<SshTerminalPanel {...defaultProps} />);
			await waitFor(() => expect(terminalInstances()[0]?.keyHandler).toBeTypeOf("function"));
			const term = terminalInstances()[0]!;
			term.selection = "selected";
			await act(async () => { term.keyHandler!(new KeyboardEvent("keydown", { key: "c", ctrlKey: true })); });
			expect(await screen.findByRole("alert")).toHaveTextContent("复制失败");
			writeText.mockResolvedValue(undefined);
			await act(async () => { term.keyHandler!(new KeyboardEvent("keydown", { key: "c", ctrlKey: true })); });
			expect(screen.queryByRole("alert")).not.toBeInTheDocument();
			expect(term.selection).toBe("selected");
		} finally {
			vi.unstubAllGlobals();
		}
	});

	it("keeps the copy tip in the command panel, not above the terminal", async () => {
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		expect(screen.queryByText(/Ctrl\+Shift\+C/)).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: "命令面板" }));
		expect(screen.getByText(/Ctrl\+Shift\+C/)).toHaveTextContent("Shift");
	});

	it("resets the terminal's modes from the command panel without sending anything", async () => {
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(terminalInstances()).toHaveLength(1));
		const term = terminalInstances()[0] as unknown as { write: ReturnType<typeof vi.fn> };
		const write = vi.spyOn(term, "write");
		await user.click(screen.getByRole("button", { name: "命令面板" }));
		await user.click(screen.getByRole("button", { name: "重置终端状态" }));
		expect(write).toHaveBeenCalledWith(expect.stringContaining("\x1b[?1003l"));
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

	it("offers full screen only when the host provides it", () => {
		render(<SshTerminalPanel {...defaultProps} />);

		expect(screen.queryByRole("button", { name: "全屏" })).not.toBeInTheDocument();
	});

	it("asks the host to toggle full screen", async () => {
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		const onToggleFullscreen = vi.fn();
		render(<SshTerminalPanel {...defaultProps} onToggleFullscreen={onToggleFullscreen} />);

		await user.click(screen.getByRole("button", { name: "全屏" }));
		expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
	});

	it("in full screen keeps only the strip: status, command panel and the way out", () => {
		const onToggleFullscreen = vi.fn();
		render(<SshTerminalPanel {...defaultProps} fullscreen onToggleFullscreen={onToggleFullscreen} />);

		expect(screen.queryByPlaceholderText("搜索终端输出…")).not.toBeInTheDocument();
		expect(screen.queryByText("203.0.113.10:22")).not.toBeInTheDocument();
		expect(screen.queryByRole("button", { name: "文件" })).not.toBeInTheDocument();
		expect(screen.getByRole("status")).toHaveTextContent("连接中");
		expect(screen.getByRole("button", { name: "命令面板" })).toBeInTheDocument();
		expect(screen.getByTestId("ssh-terminal-surface")).toBeInTheDocument();

		const { fireEvent } = require("@testing-library/react");
		fireEvent.click(screen.getByRole("button", { name: "退出全屏" }));
		expect(onToggleFullscreen).toHaveBeenCalledTimes(1);
	});

	it("lets the user pick a font size that the terminal applies and the browser remembers", async () => {
		window.localStorage.clear();
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(terminalInstances()).toHaveLength(1));
		const term = terminalInstances()[0]! as MockTerm & { options: { fontSize?: number } };
		expect(term.options.fontSize).toBe(14);

		await user.click(screen.getByRole("button", { name: "命令面板" }));
		await user.click(screen.getByRole("button", { name: "放大终端字号" }));
		await user.click(screen.getByRole("button", { name: "放大终端字号" }));

		expect(window.localStorage.getItem("ssh-terminal-font-size")).toBe("16");
		expect(term.options.fontSize).toBe(16);
		expect(screen.getByText("16 px")).toBeInTheDocument();

		await user.click(screen.getByRole("button", { name: "缩小终端字号" }));
		expect(term.options.fontSize).toBe(15);
	});

	it("builds the terminal with the remembered font size", async () => {
		window.localStorage.setItem("ssh-terminal-font-size", "18");
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(terminalInstances()).toHaveLength(1));
		const term = terminalInstances()[0]! as MockTerm & { options: { fontSize?: number } };
		expect(term.options.fontSize).toBe(18);
		window.localStorage.clear();
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
		term.buffer.active.viewportY = 0;
		fireTouch(surface, "touchstart", 300);
		let move = fireTouch(surface, "touchmove", 360);
		expect(move.defaultPrevented).toBe(false);
		expect(term.scrollLines).not.toHaveBeenCalled();

		// Pinned at the bottom: dragging up (newer) has nowhere to go either.
		term.buffer.active.viewportY = 76; // + rows(24) === length(100)
		fireTouch(surface, "touchstart", 300);
		move = fireTouch(surface, "touchmove", 250);
		expect(move.defaultPrevented).toBe(false);
		expect(term.scrollLines).not.toHaveBeenCalled();
	});

	it.each([
		["LINUX", "ls -la", "systeminfo"],
		["WINDOWS", "cmd /c ver", "ls -la"],
	] as const)("sends %s quick commands for the selected server", async (operatingSystem, command, otherCommand) => {
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} operatingSystem={operatingSystem} />);
		await user.click(screen.getByRole("button", { name: "命令面板" }));
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		const socket = MockWebSocket.instances[0]!;
		const send = vi.spyOn(socket, "send");
		connectSocket(socket);
		expect(screen.queryByRole("button", { name: otherCommand })).not.toBeInTheDocument();
		await user.click(screen.getByRole("button", { name: command }));
		expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: encodeBase64(`${command}\r`) }));
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
			socket.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
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
			socket.onmessage?.({ data: JSON.stringify({ type: "connected" }) });
		});
		await user.click(screen.getByRole("button", { name: "Shift+Tab" }));
		expect(send).toHaveBeenCalledWith(JSON.stringify({ type: "input", data: encodeBase64("\u001b[Z") }));
	});

	it("keeps the session across a disconnect by default and remembers the choice", async () => {
		window.localStorage.clear();
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		expect(MockWebSocket.instances[0]!.url).toContain("keepAlive=1");
		expect(MockWebSocket.instances[0]!.url).not.toContain("resume=");

		await user.click(screen.getByRole("button", { name: "命令面板" }));
		const toggle = screen.getByRole("checkbox", { name: /中断后保留会话/ });
		expect(toggle).toBeChecked();
		await user.click(toggle);
		expect(window.localStorage.getItem("ssh-terminal-keep-alive")).toBe("0");
		expect(toggle).not.toBeChecked();
	});

	it("reconnects into the shell the proxy kept and keeps the terminal's content", async () => {
		window.localStorage.clear();
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		await waitFor(() => expect(terminalInstances()).toHaveLength(1));
		const first = MockWebSocket.instances[0]!;
		connectSocket(first, { resumeId: "shell-1", resumed: false, keepAliveMs: 600_000 });
		expect(screen.getByRole("status")).toHaveTextContent("已连接");

		act(() => { first.readyState = MockWebSocket.CLOSED; first.onclose?.(); });
		expect(screen.getByRole("status")).toHaveTextContent("已断开");
		await user.click(screen.getByRole("button", { name: "重连" }));

		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
		const second = MockWebSocket.instances[1]!;
		expect(second.url).toContain("keepAlive=1");
		expect(second.url).toContain("resume=shell-1");
		connectSocket(second, { resumeId: "shell-1", resumed: true, keepAliveMs: 600_000 });
		expect(screen.getByTestId("ssh-terminal-session-notice")).toHaveTextContent("已接回中断前的会话。");
		// The same xterm instance serves both connections: nothing on screen is lost.
		expect(terminalInstances()).toHaveLength(1);
	});

	it("says so when the proxy could not keep the shell and starts fresh", async () => {
		window.localStorage.clear();
		const { userEvent } = require("@testing-library/user-event");
		const user = userEvent.setup();
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		connectSocket(MockWebSocket.instances[0]!, { resumeId: "shell-1", resumed: false, keepAliveMs: 600_000 });
		act(() => { MockWebSocket.instances[0]!.onclose?.(); });
		await user.click(screen.getByRole("button", { name: "重连" }));
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(2));
		connectSocket(MockWebSocket.instances[1]!, { resumeId: "shell-2", resumed: false, keepAliveMs: 600_000 });
		expect(screen.getByTestId("ssh-terminal-session-notice")).toHaveTextContent("已重新建立会话，之前的进程已结束。");
	});

	it("asks for a plain shell when keeping sessions is switched off", async () => {
		window.localStorage.setItem("ssh-terminal-keep-alive", "0");
		render(<SshTerminalPanel {...defaultProps} />);
		await waitFor(() => expect(MockWebSocket.instances).toHaveLength(1));
		expect(MockWebSocket.instances[0]!.url).not.toContain("keepAlive");
		window.localStorage.clear();
	});
});

