import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { SshTerminalModal } from "../ssh-terminal-modal";

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

vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

describe("SshTerminalModal", () => {
  it("renders as a labelled modal dialog with accessible status and controls", async () => {
    render(
      <SshTerminalModal
        serverId="srv_1"
        serverName="prod-vps"
        host="203.0.113.10:22"
        sessionToken="session-token"
        onClose={vi.fn()}
      />,
    );

    const dialog = screen.getByRole("dialog", { name: "SSH 终端 — prod-vps" });
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAccessibleDescription("203.0.113.10:22");
    expect(screen.getByRole("status")).toHaveTextContent("连接中");
    expect(screen.getByRole("button", { name: "📋 命令面板" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "关闭 SSH 终端" })).toBeInTheDocument();
  });
});
