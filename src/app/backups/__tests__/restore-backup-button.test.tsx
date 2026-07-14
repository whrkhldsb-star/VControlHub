import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { RestoreBackupButton } from "../restore-backup-button";

const refreshMock = vi.fn();

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

describe("RestoreBackupButton", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({ restoredAt: "2026-05-30T00:00:00.000Z" });
  });

  it("requires an explicit visible restore confirmation label before calling the API", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await userEvent.click(screen.getByRole("button", { name: "恢复" }));

    expect(screen.getByRole("dialog", { name: "确认恢复备份" })).toBeInTheDocument();
    expect(screen.getByLabelText("输入 RESTORE 确认恢复")).toHaveAttribute("placeholder", "RESTORE");
    expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
    expect(csrfFetch).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("输入 RESTORE 确认恢复"), "RESTORE");

    expect(screen.getByRole("button", { name: "确认恢复" })).toBeEnabled();
  });

  it("keeps restore blocked for the wrong confirmation", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await userEvent.type(screen.getByLabelText("输入 RESTORE 确认恢复"), "RESTOR");

    expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("posts to the restore API through csrfFetch and refreshes server-rendered records", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await userEvent.type(screen.getByLabelText("输入 RESTORE 确认恢复"), "RESTORE");
    await userEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/backups/bak1/restore", expect.objectContaining({ method: "POST", body: JSON.stringify({ confirm: "RESTORE", component: "all" }) })));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.getByText(/恢复已执行/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "确认恢复备份" })).not.toBeInTheDocument();
  });

  it("renders the restore confirm dialog as a mobile bottom sheet (TR-022 R10)", async () => {
    const user = userEvent.setup();
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await user.click(screen.getByRole("button", { name: "恢复" }));
    const dialog = await screen.findByRole("dialog", { name: "确认恢复备份" });
    const backdrop = dialog.parentElement as HTMLElement;
    // Backdrop must switch between items-end (mobile sheet) and sm:items-center (centered)
    expect(backdrop.className).toMatch(/items-end/);
    expect(backdrop.className).toMatch(/sm:items-center/);
    expect(backdrop.className).toMatch(/overflow-y-auto/);
    // The dialog itself must drop the fixed mx on mobile (full-width sheet)
    expect(dialog.className).toMatch(/mx-0/);
    expect(dialog.className).toMatch(/sm:mx-4/);
    expect(dialog.className).toMatch(/rounded-t-2xl/);
    expect(dialog.className).toMatch(/sm:rounded-2xl/);
    // Cancel/confirm footer must stack on mobile and row on desktop
    const cancelButton = screen.getByRole("button", { name: "取消" });
    const confirmButton = screen.getByRole("button", { name: "确认恢复" });
    expect(cancelButton.className).toContain("min-h-11");
    expect(confirmButton.className).toContain("min-h-11");
    const footer = cancelButton.parentElement as HTMLElement;
    expect(footer.className).toMatch(/flex-col-reverse/);
    expect(footer.className).toMatch(/sm:flex-row/);
  });
});
