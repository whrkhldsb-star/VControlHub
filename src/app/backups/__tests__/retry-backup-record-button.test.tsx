import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    csrfFetch: vi.fn(),
    refresh: vi.fn(),
  },
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: mocks.refresh }) }));
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: mocks.csrfFetch }));

import { RetryBackupRecordButton } from "../retry-backup-record-button";

describe("RetryBackupRecordButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrfFetch.mockResolvedValue({ backup: { id: "bak1", status: "PENDING" }, taskId: "job:job1" });
  });

  it("queues failed backup records for retry and links to operation tasks", async () => {
    render(<RetryBackupRecordButton backupId="bak1" status="FAILED" />);

    fireEvent.click(screen.getByRole("button", { name: "重试备份" }));

    await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/backups/bak1/retry", { method: "POST" }));
    await waitFor(() => expect(screen.getByText(/已重新排队/)).toBeInTheDocument());
    expect(screen.getByRole("link", { name: "任务中心" })).toHaveAttribute("href", "/operation-tasks");
    expect(screen.getByText(/job:job1/)).toBeInTheDocument();
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("disables retry unless the backup record failed", () => {
    const { rerender } = render(<RetryBackupRecordButton backupId="bak1" status="PENDING" />);
    expect(screen.getByRole("button", { name: "重试备份" })).toBeDisabled();

    rerender(<RetryBackupRecordButton backupId="bak1" status="COMPLETED" />);
    expect(screen.getByRole("button", { name: "重试备份" })).toBeDisabled();
  });
});
