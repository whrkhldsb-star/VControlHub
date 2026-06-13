import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
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

function Harness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        打开 SSH 终端
      </button>
      {open ? (
        <SshTerminalModal
          serverId="srv_1"
          serverName="prod-vps"
          host="203.0.113.10:22"
          sessionToken="session-token"
          onClose={() => setOpen(false)}
        />
      ) : null}
    </>
  );
}

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
    expect(dialog).toHaveClass("sm:max-h-[92vh]");
    expect(dialog).toHaveClass("sm:rounded-3xl");
    expect(screen.getByRole("status")).toHaveTextContent("连接中");
    expect(screen.getByRole("button", { name: "📋 命令面板" })).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByRole("button", { name: "关闭 SSH 终端" })).toBeInTheDocument();
  });

  it("uses a mobile-friendly vertical terminal and command panel layout", async () => {
    const user = userEvent.setup();
    render(
      <SshTerminalModal
        serverId="srv_1"
        serverName="prod-vps"
        host="203.0.113.10:22"
        sessionToken="session-token"
        onClose={vi.fn()}
      />,
    );

    const terminalSurface = screen.getByTestId("ssh-terminal-surface");
    expect(terminalSurface).toHaveClass("lg:min-h-[400px]");

    await user.click(screen.getByRole("button", { name: "📋 命令面板" }));

    const favoriteInput = screen.getByLabelText("添加常用 SSH 命令");
    let sidePanel = favoriteInput.parentElement;
    while (sidePanel && !sidePanel.classList.contains("lg:w-64")) {
      sidePanel = sidePanel.parentElement;
    }
    expect(sidePanel).toHaveClass("max-h-[50vh]", "w-full", "lg:w-64");
  });

  it("manages focus with the shared dialog focus behavior", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    const opener = screen.getByRole("button", { name: "打开 SSH 终端" });
    opener.focus();
    await user.click(opener);

    const closeButton = await screen.findByRole("button", { name: "关闭 SSH 终端" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.keyboard("{Escape}");

    await waitFor(() => expect(screen.queryByRole("dialog", { name: "SSH 终端 — prod-vps" })).not.toBeInTheDocument());
    expect(opener).toHaveFocus();
  });

  it("keeps tab focus inside the terminal dialog", async () => {
    const user = userEvent.setup();
    render(<Harness />);

    await user.click(screen.getByRole("button", { name: "打开 SSH 终端" }));
    const closeButton = await screen.findByRole("button", { name: "关闭 SSH 终端" });
    await waitFor(() => expect(closeButton).toHaveFocus());

    await user.tab({ shift: true });

    expect(screen.getByRole("button", { name: "重连" })).toHaveFocus();
  });

  it("exposes 44px touch targets on header and side-panel controls (TR-022 R11)", async () => {
    const user = userEvent.setup();
    render(
      <SshTerminalModal
        serverId="srv_1"
        serverName="prod-vps"
        host="203.0.113.10:22"
        sessionToken="session-token"
        onClose={vi.fn()}
      />,
    );

    // Header: 命令面板 toggle + 关闭 button must hit 44px touch targets
    const panelToggle = screen.getByRole("button", { name: "📋 命令面板" });
    const closeButton = screen.getByRole("button", { name: "关闭 SSH 终端" });
    expect(panelToggle.className).toContain("min-h-11");
    expect(closeButton.className).toContain("min-h-11");

    // Open the side panel so the remaining controls are rendered
    await user.click(panelToggle);

    // Side panel: input + add (+) controls must hit 44px touch targets
    const favoriteInput = screen.getByLabelText("添加常用 SSH 命令");
    const addButton = screen.getByRole("button", { name: "添加常用命令" });
    expect(favoriteInput.className).toContain("min-h-11");
    expect(addButton.className).toContain("min-h-11");

    // Add a favorite so the per-row ✕ remove button is rendered and testable
    await user.type(favoriteInput, "ls -la");
    await user.click(addButton);

    const removeButton = screen.getByRole("button", { name: /^删除常用命令 / });
    expect(removeButton.className).toContain("min-h-11");

    // The hover-only ✕ must be at least partially visible by default so touch
    // users can actually reach it (opacity-0 group-hover:opacity-100 is desktop-only)
    expect(removeButton.className).not.toMatch(/\bopacity-0\b/);
  });
});
