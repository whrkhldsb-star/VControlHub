import type React from "react";
import { screen } from "@testing-library/react";
import { renderWithI18n as render } from "@/lib/i18n/__tests__/test-helpers";
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
    vi.mocked(csrfFetch).mockRejectedValue(new Error("Notification API unavailable"));

    render(<NotificationBell />, { locale: "en" });
    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByText("Notification API unavailable")).toBeInTheDocument();
    expect(screen.queryByText("No notifications")).not.toBeInTheDocument();
  });

  it("does not optimistically mark all as read when the API fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockImplementation(async (_url, options) => {
      if (options?.method === "PATCH") throw new Error("Mark all read API failed");
      return {
        unreadCount: 1,
        notifications: [{
          id: "n_unread",
          type: "system",
          title: "Pending notification",
          message: "Should remain unread when API fails",
          isRead: false,
          actionUrl: "/notifications",
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      };
    });
    window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));

    render(<NotificationBell />, { locale: "en" });
    await user.click(screen.getByRole("button", { name: "Notifications" }));
    expect(await screen.findByText("Pending notification")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Mark all read" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Mark all read API failed");
    expect(screen.getByText("Pending notification").closest("a")).not.toHaveClass("opacity-60");
  });

  it("falls back to notifications page for unsafe notification action URLs", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValue({
        unreadCount: 1,
        notifications: [{
          id: "n_unsafe",
          type: "system",
          title: "Dangerous notification link",
          message: "Should not open script links",
          isRead: false,
          actionUrl: "javascript:alert(1)",
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      });
    window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));

    render(<NotificationBell />, { locale: "en" });
    await user.click(screen.getByRole("button", { name: "Notifications" }));

    const notificationLink = (await screen.findByText("Dangerous notification link")).closest("a");
    expect(notificationLink).toHaveAttribute("href", "/notifications");
  });

  it("uses the saved global refresh interval for fallback polling", async () => {
    vi.useFakeTimers();
    window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 60 }));
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(<NotificationBell />, { locale: "en" });

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

    render(<NotificationBell />, { locale: "en" });

    expect(setIntervalSpy).not.toHaveBeenCalledWith(expect.any(Function), 30_000);
    expect(csrfFetch).not.toHaveBeenCalled();
  });

  it("renders the dropdown as an accessible popover and closes it with Escape", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch)
      .mockResolvedValueOnce({ unreadCount: 0 })
      .mockResolvedValueOnce({ unreadCount: 0, notifications: [] });

    render(<NotificationBell />, { locale: "en" });
    const trigger = screen.getByRole("button", { name: "Notifications" });
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");

    await user.click(trigger);

    expect(await screen.findByRole("dialog", { name: "Notifications" })).toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByText("No notifications")).toHaveClass("text-[var(--text-muted)]");

    await user.keyboard("{Escape}");

    expect(screen.queryByRole("dialog", { name: "Notifications" })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute("aria-expanded", "false");
  });

  it("uses client-side Next links for notification navigation targets", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockResolvedValue({
        unreadCount: 1,
        notifications: [{
          id: "n_internal",
          type: "system",
          title: "Internal notification link",
          message: "Should use Next Link for client-side navigation",
          isRead: false,
          actionUrl: "/servers",
          createdAt: "2026-05-25T00:00:00.000Z",
        }],
      });
    window.localStorage.setItem("vps-preferences", JSON.stringify({ autoRefreshInterval: 0 }));

    render(<NotificationBell />, { locale: "en" });
    await user.click(screen.getByRole("button", { name: "Notifications" }));

    expect(await screen.findByRole("link", { name: /Internal notification link/ })).toHaveAttribute("href", "/servers");
    expect(screen.getByRole("link", { name: "View all notifications →" })).toHaveAttribute("href", "/notifications");
  });
});
