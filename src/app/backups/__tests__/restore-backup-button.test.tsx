import { render, screen, waitFor } from "@testing-library/react";
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

  it("requires explicit in-page confirmation before calling the restore API", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await userEvent.click(screen.getByRole("button", { name: "执行恢复" }));

    expect(screen.getByRole("dialog", { name: "确认恢复备份" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "确认恢复" })).toBeDisabled();
    expect(csrfFetch).not.toHaveBeenCalled();

    await userEvent.type(screen.getByLabelText("确认文本"), "RESTORE");

    expect(screen.getByRole("button", { name: "确认恢复" })).toBeEnabled();
  });

  it("posts to the restore API through csrfFetch and refreshes server-rendered records", async () => {
    render(<RestoreBackupButton backupId="bak1" backupType="DATABASE" />);

    await userEvent.click(screen.getByRole("button", { name: "执行恢复" }));
    await userEvent.type(screen.getByLabelText("确认文本"), "RESTORE");
    await userEvent.click(screen.getByRole("button", { name: "确认恢复" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/backups/bak1/restore", expect.objectContaining({ method: "POST", body: JSON.stringify({ confirm: "RESTORE" }) })));
    expect(refreshMock).toHaveBeenCalledOnce();
    expect(screen.getByText(/恢复已执行/)).toBeInTheDocument();
    expect(screen.queryByRole("dialog", { name: "确认恢复备份" })).not.toBeInTheDocument();
  });
});
