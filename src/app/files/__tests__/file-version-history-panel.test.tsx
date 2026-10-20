import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { csrfFetch } from "@/lib/auth/csrf-client";
import { ApiError } from "@/lib/http/api-client";
import { t } from "@/lib/i18n/translations";
import { FileVersionHistoryPanel } from "../file-version-history-panel";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));
vi.mock("@/lib/i18n/use-locale", () => ({
  useI18n: () => ({ locale: "zh", t: (key: string, vars?: Record<string, string | number>) => t(key, "zh", vars) }),
}));

const mockedFetch = vi.mocked(csrfFetch);
const version = {
  id: "ver_1",
  versionNumber: 1,
  name: "notes.txt",
  sizeBytes: 8,
  checksumSha256: "abc",
  reason: "MANUAL" as const,
  note: null,
  createdByName: "admin",
  createdAt: "2026-10-20T00:00:00.000Z",
};

describe("FileVersionHistoryPanel restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks again, saying the restore cannot be undone, when no snapshot of the current content could be saved", async () => {
    // The confirmation promised a snapshot first; when none could be saved the
    // restore used to go ahead and the current content was lost for good.
    const unsafe = "无法先保存当前内容的快照";
    mockedFetch.mockImplementation(async (url, init) => {
      if (!init?.method) return { versions: [version] };
      if (!String(url).includes("allowWithoutRestorePoint=1")) throw new ApiError(409, { code: "CONFLICT", message: unsafe });
      return { success: true };
    });
    const onNotify = vi.fn();
    const user = userEvent.setup();
    render(<FileVersionHistoryPanel fileEntryId="fe_1" canWrite onNotify={onNotify} />);

    await user.click(await screen.findByRole("button", { name: t("fileVersionHistory.restore", "zh") }));
    await user.click(screen.getByRole("button", { name: t("fileVersionHistory.restoreConfirmBtn", "zh") }));

    expect(await screen.findByText(unsafe)).toBeInTheDocument();
    expect(onNotify).not.toHaveBeenCalledWith("success", expect.anything());
    await user.click(screen.getByRole("button", { name: t("fileVersionHistory.restoreWithoutSnapshotBtn", "zh") }));

    await waitFor(() => expect(onNotify).toHaveBeenCalledWith("success", t("fileVersionHistory.restoreSuccess", "zh")));
    const restoreCalls = mockedFetch.mock.calls.filter(([, init]) => init?.method === "POST");
    expect(restoreCalls.map(([url]) => String(url))).toEqual([
      "/api/files/fe_1/versions/ver_1/restore",
      "/api/files/fe_1/versions/ver_1/restore?allowWithoutRestorePoint=1",
    ]);
  });
});
