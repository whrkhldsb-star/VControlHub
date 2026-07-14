import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

const csrfFetchMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: csrfFetchMock }));
vi.mock("@/lib/i18n/use-locale", () => ({ useI18n: () => ({ t: (key: string) => key }) }));
import { BackupDrillButton } from "../backup-drill-button";

describe("BackupDrillButton", () => {
  it("queues a drill and links to the task report", async () => {
    csrfFetchMock.mockResolvedValue({ taskId: "job:j1", deduped: false });
    const user = userEvent.setup();
    render(<BackupDrillButton backupId="b1" disabled={false} />);
    await user.click(screen.getByRole("button", { name: "backupsPage.drill.submit" }));
    expect(csrfFetchMock).toHaveBeenCalledWith("/api/backups/b1/drill", { method: "POST" });
    expect(await screen.findByText(/job:j1/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "backupsPage.drill.openTasks" })).toHaveAttribute("href", "/operation-tasks");
  });
});
