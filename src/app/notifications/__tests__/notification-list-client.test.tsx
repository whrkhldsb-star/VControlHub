import { act, screen, within } from "@testing-library/react";
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
const INITIAL_NOW = "2026-05-25T00:05:00.000Z";

describe("NotificationListClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows an error and keeps unread state when marking one notification fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValue(new Error("单条已读失败"));

    render(<NotificationListClient initialNotifications={[unreadNotification]} initialUnreadCount={1} initialNow={INITIAL_NOW} />);

    await user.click(screen.getByRole("button", { name: "标为已读" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("单条已读失败");
    expect(screen.getByRole("button", { name: "标为已读" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部标记已读" })).toBeInTheDocument();
  });

  it("shows an error and keeps the notification visible when deletion fails", async () => {
    const user = userEvent.setup();
    vi.mocked(csrfFetch).mockRejectedValue(new Error("删除通知失败"));

    render(<NotificationListClient initialNotifications={[unreadNotification]} initialUnreadCount={1} initialNow={INITIAL_NOW} />);

    await user.click(screen.getByRole("button", { name: "删除" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("删除通知失败");
    expect(screen.getByText("需要处理的通知")).toBeInTheDocument();
    expect(screen.queryByText("暂无通知")).not.toBeInTheDocument();
  });

  it("says so when the unread view has nothing to show, with the way back to everything", async () => {
    // "Unread only" with everything read was a blank area under the filter.
    const user = userEvent.setup();
    render(<NotificationListClient initialNotifications={[{ ...unreadNotification, isRead: true }]} initialUnreadCount={0} initialNow={INITIAL_NOW} />);

    await user.click(screen.getByRole("button", { name: "只看未读" }));
    expect(screen.queryByText("需要处理的通知")).not.toBeInTheDocument();
    expect(screen.getByText("所有通知已读")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "查看全部通知" }));
    expect(screen.getByText("需要处理的通知")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "只看未读" })).toHaveAttribute("aria-pressed", "false");
  });

  it("does not call everything read while unread notifications are further down the list", async () => {
    const user = userEvent.setup();
    // A full first page (50) means there is more on the server.
    const firstPage = Array.from({ length: 50 }, (_, index) => ({ ...unreadNotification, id: `n_${index}`, isRead: true }));
    vi.mocked(csrfFetch).mockResolvedValue({ notifications: [], hasMore: false });
    render(<NotificationListClient initialNotifications={firstPage} initialUnreadCount={3} initialNow={INITIAL_NOW} />);

    await user.click(screen.getByRole("button", { name: /只看未读/ }));
    expect(screen.queryByText("所有通知已读")).not.toBeInTheDocument();
    expect(screen.getByText("还有 3 条未读通知在更早的记录里")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "加载更多" })).toBeInTheDocument();
  });

  it("falls back to the notification center for unsafe action URLs", () => {
    render(
      <NotificationListClient
        initialNotifications={[{ ...unreadNotification, actionUrl: "javascript:alert(1)" }]}
        initialUnreadCount={1}
        initialNow={INITIAL_NOW}
      />,
    );

    expect(screen.getByRole("link", { name: "查看详情" })).toHaveAttribute("href", "/notifications");
  });

  it("keeps destructive actions reachable by keyboard focus and small screens", () => {
    render(<NotificationListClient initialNotifications={[unreadNotification]} initialUnreadCount={1} initialNow={INITIAL_NOW} />);

    const deleteButton = screen.getByRole("button", { name: "删除" });
    expect(deleteButton).not.toHaveClass("opacity-0");
    // A shared ActionButton: visible focus ring from the global :focus-visible rule.
    expect(deleteButton).toHaveAttribute("data-action-button");
    expect(deleteButton.closest("article")).toHaveClass("focus-within:ring-2");
  });

  it("counts a notification once when its mark-read and delete finish together", async () => {
    // The delete took the notification as unread from the list it started
    // with; mark-read had already counted it: the badge lost the other one.
    const user = userEvent.setup();
    const second = { ...unreadNotification, id: "n_2", title: "第二条通知" };
    const answers: Array<() => void> = [];
    vi.mocked(csrfFetch).mockImplementation(() => new Promise((resolve) => { answers.push(() => resolve({} as never)); }) as never);
    render(<NotificationListClient initialNotifications={[unreadNotification, second]} initialUnreadCount={2} initialNow={INITIAL_NOW} />);

    const first = screen.getByText("需要处理的通知").closest("li") ?? screen.getByText("需要处理的通知").parentElement!.parentElement!;
    await user.click(within(first as HTMLElement).getByRole("button", { name: "标为已读" }));
    await user.click(within(first as HTMLElement).getByRole("button", { name: "删除" }));
    expect(answers).toHaveLength(2);
    await act(async () => { answers[0]!(); answers[1]!(); });

    expect(screen.queryByText("需要处理的通知")).not.toBeInTheDocument();
    expect(screen.getByText("只看未读 (1)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "全部标记已读" })).toBeInTheDocument();
  });

  it("fetches the next batch after the last notification on screen is deleted", async () => {
    // The page showed "no notifications" while the 51st still existed.
    const first = Array.from({ length: 50 }, (_, i) => ({ ...unreadNotification, id: `n_${i}`, title: `通知 ${i}`, isRead: true }));
    const next = { ...unreadNotification, id: "n_50", title: "第 51 条通知", isRead: true };
    vi.mocked(csrfFetch).mockImplementation((async (_url: unknown, init?: { method?: string }) => {
      if (init?.method === "DELETE") return {};
      return { notifications: [next], hasMore: false };
    }) as never);
    const { fireEvent } = await import("@testing-library/react");
    render(<NotificationListClient initialNotifications={first} initialUnreadCount={0} initialNow={INITIAL_NOW} />);

    for (let i = 0; i < 50; i++) {
      await act(async () => {
        fireEvent.click(screen.getAllByRole("button", { name: "删除" })[0]!);
      });
    }

    expect(await screen.findByText("第 51 条通知")).toBeInTheDocument();
    expect(vi.mocked(csrfFetch)).toHaveBeenCalledWith("/api/notifications?limit=50&offset=0");
  });
});
