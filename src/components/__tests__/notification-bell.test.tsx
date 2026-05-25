import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { NotificationBell } from "../notification-bell";
import { csrfFetch } from "@/lib/auth/csrf-client";

const wsState = vi.hoisted(() => ({
  connected: false,
  lastNotification: null,
  unreadCount: 0,
  lastServerAlert: null,
}));

vi.mock("@/lib/ws/use-ws-notifications", () => ({
  useWsNotifications: () => wsState,
}));

vi.mock("@/lib/auth/csrf-client", () => ({
  csrfFetch: vi.fn(),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    wsState.connected = false;
    wsState.lastNotification = null;
    wsState.unreadCount = 0;
    wsState.lastServerAlert = null;
    vi.mocked(csrfFetch).mockResolvedValue({ unreadCount: 1, notifications: [] });
  });

  it("surfaces notification list load errors in the dropdown", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValue(new Error("通知接口不可用"));

    render(<NotificationBell />);
    await user.click(screen.getByRole("button", { name: "通知" }));

    expect(await screen.findByText("通知接口不可用")).toBeInTheDocument();
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
  });

  it("does not optimistically mark all as read when the API fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ unreadCount: 1 })
      .mockResolvedValueOnce({
        unreadCount: 1,
        notifications: [{
          id: "n_1",
          type: "system",
          title: "待处理通知",
          message: "需要确认",
          isRead: false,
          actionUrl: null,
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      })
      .mockRejectedValueOnce(new Error("标记失败"));

    render(<NotificationBell />);
    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/notifications"));
    await user.click(screen.getByRole("button", { name: "通知" }));
    expect(await screen.findByText("待处理通知")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部已读" }));

    expect(await screen.findByText("标记失败")).toBeInTheDocument();
    expect(screen.getByText("待处理通知")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部已读" })).toBeInTheDocument();
  });
});
