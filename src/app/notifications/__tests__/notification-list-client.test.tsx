import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationListClient } from "../notification-list-client";
import { csrfFetch } from "@/lib/auth/csrf-client";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

const unreadNotification = {
  id: "n_1",
  type: "system",
  title: "需要处理的通知",
  message: "请检查系统状态",
  isRead: false,
  actionUrl: "/health",
  createdAt: "2026-05-25T00:00:00.000Z",
};

describe("NotificationListClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an error and keeps unread state when marking one notification fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValue(new Error("单条已读失败"));

    render(<NotificationListClient initialNotifications={[unreadNotification]} initialUnreadCount={1} />);

    await user.click(screen.getByRole("button", { name: "标为已读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("单条已读失败");
    expect(screen.getByRole("button", { name: "标为已读" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部标记已读" })).toBeInTheDocument();
  });

  it("shows an error and keeps the notification visible when deletion fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValue(new Error("删除通知失败"));

    render(<NotificationListClient initialNotifications={[unreadNotification]} initialUnreadCount={1} />);

    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除通知失败");
    expect(screen.getByText("需要处理的通知")).toBeInTheDocument();
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
  });

  it("falls back to the notification center for unsafe action URLs", () => {
    render(
      <NotificationListClient
        initialNotifications={[{ ...unreadNotification, actionUrl: "javascript:alert(1)" }]}
        initialUnreadCount={1}
      />,
    );

    expect(screen.getByRole("link", { name: "查看详情 →" })).toHaveAttribute("href", "/notifications");
  });

  it("keeps destructive actions reachable by keyboard focus and small screens", () => {
    render(<NotificationListClient initialNotifications={[unreadNotification]} initialUnreadCount={1} />);

    const deleteButton = screen.getByRole("button", { name: "删除" });
    expect(deleteButton).toHaveClass("opacity-100");
    expect(deleteButton).toHaveClass("sm:group-focus-within:opacity-100");
    expect(deleteButton).toHaveClass("focus-visible:ring-2");
    expect(deleteButton.closest("article")).toHaveClass("focus-within:ring-2");
  });
});
