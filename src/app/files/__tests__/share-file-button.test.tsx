import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ShareFileButton } from "../share-file-button";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({ csrfFetch: vi.fn() }));

const entry = {
  id: "file_1",
  name: "report.pdf",
  entryType: "FILE",
  relativePath: "docs/report.pdf",
  sizeLabel: "1 MB",
  previewable: true,
  directAccess: { mode: "PROXY", description: "通过控制台下载" },
  storageNode: { id: "node_1", name: "Local", driver: "LOCAL" },
};

describe("ShareFileButton", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.assign(navigator, { clipboard: { writeText: vi.fn().mockResolvedValue(undefined) } });
  });

  it("requires acknowledgement and creates a bounded quick share", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ token: "share-token" });

    render(<ShareFileButton entry={entry} />);

    await user.click(screen.getByRole("button", { name: "分享 report.pdf" }));
    expect(screen.getByRole("heading", { name: "创建临时公开分享？" })).toBeInTheDocument();
    expect(screen.getByText(/24 小时后自动失效/)).toBeInTheDocument();
    expect(csrfFetch).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "创建临时链接" }));
    expect(csrfFetch).toHaveBeenCalledWith("/api/share-links", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fileEntryId: "file_1", quick: true }),
    });
  });
});
