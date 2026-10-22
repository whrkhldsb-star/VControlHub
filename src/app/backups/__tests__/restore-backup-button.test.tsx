import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { RestoreBackupButton } from "../restore-backup-button";
import { expectBottomSheet, expectTouchTarget } from "@/test/ui-assertions";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const plan = {
  checksumSha256: "a92e0ec81286ff0f9ccf5982a22a83a0b70082446d5fd7af0eb9a3ceacd16c86",
  component: "all",
  commands: {
    stopServices: "sudo systemctl stop vcontrolhub-next vcontrolhub-worker vcontrolhub-ssh-ws",
    safetySnapshot: "cd '/opt/app' && bash deploy/backup.sh --full 'backups/pre-restore-bak1-1.tar.gz'",
    restore: "cd '/opt/app' && CONFIRM_RESTORE=1 bash scripts/restore-full.sh 'backups/full.tar.gz' 'all' '/opt/app'",
    startServices: "sudo systemctl start vcontrolhub-ssh-ws vcontrolhub-worker vcontrolhub-next",
  },
};

describe("RestoreBackupButton (offline restore)", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(csrfFetch).mockResolvedValue({ offlineRestore: plan });
  });

  it("explains that restore is offline only and calls nothing until asked to verify", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="FULL" />);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));

    expect(screen.getByRole("dialog", { name: "离线恢复" })).toHaveTextContent(/只能在平台停机时执行/);
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("verifies the backup on the server and shows the runbook in order", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="FULL" />);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await userEvent.click(screen.getByRole("button", { name: "仅数据库" }));
    await userEvent.click(screen.getByRole("button", { name: "校验并生成步骤" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/backups/bak1/restore", expect.objectContaining({ method: "POST", body: JSON.stringify({ component: "database" }) })));
    expect(await screen.findByText(/备份校验通过（SHA-256 a92e0ec81286…）/)).toBeInTheDocument();
    const commands = screen.getAllByText(/systemctl|backup\.sh|restore-full\.sh/).map((node) => node.textContent);
    expect(commands).toEqual([plan.commands.stopServices, plan.commands.safetySnapshot, plan.commands.restore, plan.commands.startServices]);
  });

  it("shows the server's refusal (e.g. checksum mismatch) instead of any steps", async () => {
    vi.mocked(csrfFetch).mockRejectedValue(new Error("备份校验和验证失败，产物可能已损坏或被篡改"));
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await userEvent.click(screen.getByRole("button", { name: "校验并生成步骤" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("备份校验和验证失败");
    expect(screen.queryByText(/systemctl/)).not.toBeInTheDocument();
  });

  it("renders the dialog as a mobile bottom sheet with touch-sized actions", async () => {
    const user = userEvent.setup();
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await user.click(screen.getByRole("button", { name: "恢复" }));
    const dialog = await screen.findByRole("dialog", { name: "离线恢复" });
    expectBottomSheet(dialog);
    const closeButton = screen.getByRole("button", { name: "取消" });
    const prepareButton = screen.getByRole("button", { name: "校验并生成步骤" });
    expectTouchTarget(closeButton);
    expectTouchTarget(prepareButton);
    const footer = closeButton.parentElement as HTMLElement;
    expect(footer.className).toMatch(/flex-col-reverse/);
    expect(footer.className).toMatch(/sm:flex-row/);
  });

  it("never shows a plan for a component other than the one selected", async () => {
    // "All" was requested, the selection changed to files while it was
    // prepared, and the late "all" steps appeared under "files".
    let finishAll: (value: unknown) => void = () => undefined;
    vi.mocked(csrfFetch).mockImplementationOnce(() => new Promise((resolve) => { finishAll = resolve; }));
    render(<RestoreBackupButton backupId="bak1" backupType="FULL" />);
    await userEvent.click(screen.getByRole("button", { name: "恢复" }));
    await userEvent.click(screen.getByRole("button", { name: "校验并生成步骤" }));
    await userEvent.click(screen.getByRole("button", { name: "仅文件" }));
    finishAll({ offlineRestore: plan });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.queryByText(plan.commands.restore)).not.toBeInTheDocument();
  });
});
