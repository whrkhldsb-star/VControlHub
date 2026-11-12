import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

const csrfFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: csrfFetchMock }));
import { BackupDrillButton } from "../backup-drill-button";

describe("BackupDrillButton", () => {
  it("queues a drill and links to the task report", async () => {
    csrfFetchMock.mockResolvedValue({ taskId: "job:j1", deduped: false });
    const user = userEvent.setup();
    render(<BackupDrillButton backupId="b1" disabled={false} />);
    await user.click(screen.getByRole("button", { name: "执行无损恢复演练" }));
    expect(csrfFetchMock).toHaveBeenCalledWith("/api/backups/b1/drill", { method: "POST" });
    // The sentence names the task; it was followed by the same id in brackets.
    const line = (await screen.findByText(/演练任务已创建/)).textContent ?? "";
    expect(line.split("job:j1")).toHaveLength(2);
    expect(line).toContain("演练任务已创建：job:j1");
    expect(screen.getByRole("link", { name: "查看任务报告" })).toHaveAttribute("href", "/operation-tasks");
  });

  it("says so when the backup already has a drill, or why none could be created", async () => {
    const user = userEvent.setup();
    csrfFetchMock.mockResolvedValueOnce({ taskId: "job:j0", deduped: true });
    render(<BackupDrillButton backupId="b1" disabled={false} />);
    await user.click(screen.getByRole("button", { name: "执行无损恢复演练" }));
    expect(await screen.findByText(/该备份已有演练任务：job:j0/)).toBeInTheDocument();

    csrfFetchMock.mockRejectedValueOnce(new Error("备份文件不存在，无法演练"));
    await user.click(screen.getByRole("button", { name: "执行无损恢复演练" }));
    expect(await screen.findByText("备份文件不存在，无法演练")).toBeInTheDocument();
    expect(screen.queryByText(/该备份已有演练任务/)).toBeNull();
  });
});
