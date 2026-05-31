import type React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";

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

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
}));

describe("NotificationBell", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    window.localStorage.clear();
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
          id: "n_unread",
          type: "system",
          title: "待处理通知",
          message: "接口失败时仍应保持未读状态",
          isRead: false,
          actionUrl: "/notifications",
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      })
      .mockRejectedValueOnce(new Error("全部已读接口失败"));

    render(<NotificationBell />);
    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/notifications"));
    await user.click(screen.getByRole("button", { name: "通知" }));
    expect(await screen.findByText("待处理通知")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "全部已读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("全部已读接口失败");
    expect(screen.getByText("待处理通知").closest("a")).not.toHaveClass("opacity-60");
  });

  it("falls back to notifications page for unsafe notification action URLs", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ unreadCount: 1 })
      .mockResolvedValueOnce({
        unreadCount: 1,
        notifications: [{
          id: "n_unsafe",
          type: "system",
          title: "危险通知入口",
          message: "不应打开脚本链接",
          isRead: false,
          actionUrl: "javascript:alert(1)",
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      });

    render(<NotificationBell />);
    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/notifications"));
    await user.click(screen.getByRole("button", { name: "通知" }));

    const notificationLink = (await screen.findByText("危险通知入口")).closest("a");
    expect(notificationLink).toHaveAttribute("href", "/notifications");
  });

  it("uses the saved global refresh interval for fallback polling", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 60 }));
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(<NotificationBell />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
  });

  it("disables fallback unread-count polling when the saved refresh preference is manual", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(<NotificationBell />);

    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("renders the dropdown as an accessible popover and closes it with Escape", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ unreadCount: 0 })
      .mockResolvedValueOnce({ unreadCount: 0, notifications: [] });

    render(<NotificationBell />);
    const trigger = screen.getByRole("button", { name: "通知" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(await screen.findByRole("dialog", { name: "通知" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("暂无通知")).toHaveClass("text-slate-400");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "通知" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("uses client-side Next links for notification navigation targets", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ unreadCount: 1 })
      .mockResolvedValueOnce({
        unreadCount: 1,
        notifications: [{
          id: "n_internal",
          type: "system",
          title: "内部通知入口",
          message: "应通过 Next Link 进行客户端导航",
          isRead: false,
          actionUrl: "/servers",
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      });

    render(<NotificationBell />);
    await waitFor(() => expect(csrfFetch).toHaveBeenCalledWith("/api/notifications"));
    await user.click(screen.getByRole("button", { name: "通知" }));

    expect(await screen.findByRole("link", { name: /内部通知入口/ })).toHaveAttribute("href", "/servers");
    expect(screen.getByRole("link", { name: "查看全部通知 →" })).toHaveAttribute("href", "/notifications");
  });
});
