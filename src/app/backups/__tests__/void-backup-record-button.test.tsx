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

import { VoidBackupRecordButton } from "../void-backup-record-button";

describe("VoidBackupRecordButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.csrfFetch.mockResolvedValue({ backup: { id: "bak1", status: "FAILED" } });
  });

  it("marks pending backup records void and refreshes the page", async () => {
    render(<VoidBackupRecordButton backupId="bak1" status="PENDING" />);

    fireEvent.click(screen.getByRole("button", { name: "标记作废" }));

    await waitFor(() => expect(mocks.csrfFetch).toHaveBeenCalledWith("/api/backups/bak1/void", expect.objectContaining({ method: "POST" })));
    expect(JSON.parse(mocks.csrfFetch.mock.calls[0]![1]!.body)).toMatchObject({ reason: expect.stringContaining("手动作废") });
    await waitFor(() => expect(screen.getByText("已标记为作废记录")).toBeInTheDocument());
    expect(mocks.refresh).toHaveBeenCalled();
  });

  it("disables voiding completed and running backup records", () => {
    const { rerender } = render(<VoidBackupRecordButton backupId="bak1" status="COMPLETED" />);
    expect(screen.getByRole("button", { name: "标记作废" })).toBeDisabled();

    rerender(<VoidBackupRecordButton backupId="bak1" status="RUNNING" />);
    expect(screen.getByRole("button", { name: "标记作废" })).toBeDisabled();
  });
});
