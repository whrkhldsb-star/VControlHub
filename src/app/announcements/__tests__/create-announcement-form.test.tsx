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

const addToast = vi.hoisted(() => vi.fn());
vi.mock("@/components/toast-provider", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/toast-provider")>()),
  useToast: () => ({ addToast }),
}));
const onClose = vi.fn();

import { csrfFetch } from "@/lib/auth/csrf-client";
import { CreateAnnouncementForm } from "../create-announcement-form";

describe("CreateAnnouncementForm", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("refreshes the current route after publishing without forcing a full page reload", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValueOnce({ id: "announcement_1" });

    render(<CreateAnnouncementForm onClose={onClose} />);

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
        published: true,
        startsAt: undefined,
        expiresAt: undefined,
      }),
    }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
    // Posted: said so, and the form closes on the list it joined.
    expect(addToast).toHaveBeenCalledWith("success", "公告已发布");
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps a next announcement typed while the previous one was saving", async () => {
    const user = userEvent.setup();
    let finish: (value: unknown) => void = () => undefined;
    vi.mocked(csrfFetch).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    render(<CreateAnnouncementForm onClose={onClose} />);

    await user.type(screen.getByLabelText("标题"), "A");
    await user.type(screen.getByLabelText("内容"), "A body");
    await user.click(screen.getByRole("button", { name: "发布公告" }));
    await user.clear(screen.getByLabelText("标题"));
    await user.type(screen.getByLabelText("标题"), "B");
    finish({ id: "a" });

    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    expect(screen.getByLabelText("标题")).toHaveValue("B");
    // The next one stays open as it is.
    expect(onClose).not.toHaveBeenCalled();
  });

  it("is cancelled at once while nothing is typed, and asks once something is", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<CreateAnnouncementForm onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(onClose).toHaveBeenCalledOnce();
    unmount();

    onClose.mockClear();
    render(<CreateAnnouncementForm onClose={onClose} />);
    await user.type(screen.getByLabelText("标题"), "维护公告");
    await user.click(screen.getByRole("button", { name: "取消" }));
    expect(await screen.findByRole("dialog", { name: "放弃未保存的更改？" })).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("says a refusal in the form", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValueOnce(new Error("标题已存在"));
    render(<CreateAnnouncementForm onClose={onClose} />);
    await user.type(screen.getByLabelText("标题"), "维护公告");
    await user.type(screen.getByLabelText("内容"), "今晚 23:00 维护");
    await user.click(screen.getByRole("button", { name: "发布公告" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("标题已存在");
    expect(onClose).not.toHaveBeenCalled();
  });
});
