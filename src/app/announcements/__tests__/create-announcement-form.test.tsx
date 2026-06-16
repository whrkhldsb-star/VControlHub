import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const refreshMock = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

import { csrfFetch } from "@/lib/auth/csrf-client";
import { CreateAnnouncementForm } from "../create-announcement-form";

describe("CreateAnnouncementForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the current route after publishing without forcing a full page reload", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "announcement_1" });

    render(<CreateAnnouncementForm />);

    expect(screen.getByLabelText("标题")).toHaveAccessibleDescription("显示在站内公告列表和用户通知区域的公告标题。");
    expect(screen.getByLabelText("内容")).toHaveAccessibleDescription("写清影响范围、时间窗口和用户需要执行的操作。");
    expect(screen.getByLabelText("生效时间")).toHaveAccessibleDescription("留空表示立即生效。");
    expect(screen.getByLabelText("过期时间")).toHaveAccessibleDescription("留空表示永不过期。");

    await user.type(screen.getByLabelText("标题"), "维护公告");
    await user.type(screen.getByLabelText("内容"), "今晚 23:00 维护");
    await user.selectOptions(screen.getByLabelText("类型"), "warning");
    await user.click(screen.getByRole("button", { name: "发布公告" }));

    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/announcements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "维护公告",
        content: "今晚 23:00 维护",
        type: "warning",
        startsAt: undefined,
        expiresAt: undefined,
      }),
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });
});
