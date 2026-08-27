import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  listUserNotificationsMock,
  getUnreadCountMock,
  markAsReadMock,
  markAllAsReadMock,
  deleteNotificationMock,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  listUserNotificationsMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
  markAsReadMock: vi.fn(),
  markAllAsReadMock: vi.fn(),
  deleteNotificationMock: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));

vi.mock("@/lib/notification/service", () => ({
  listUserNotifications: listUserNotificationsMock,
  getUnreadCount: getUnreadCountMock,
  markAsRead: markAsReadMock,
  markAllAsRead: markAllAsReadMock,
  deleteNotification: deleteNotificationMock,
}));

import { DELETE, GET, PATCH } from "../route";

const session = { userId: "u_1", username: "alice" };

describe("/api/notifications", () => {
  it("returns notifications for the authenticated user only", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);
    listUserNotificationsMock.mockResolvedValueOnce([{ id: "n_1" }]);
    getUnreadCountMock.mockResolvedValueOnce(1);

    const response = await GET(
      new Request("https://example.com/api/notifications"),
    );

    expect(response.status).toBe(200);
    expect(requireApiSessionMock).toHaveBeenCalled();
    expect(listUserNotificationsMock).toHaveBeenCalledWith("u_1", {
      limit: 50,
      skip: 0,
    });
    expect(getUnreadCountMock).toHaveBeenCalledWith("u_1");
    await expect(response.json()).resolves.toMatchObject({ unreadCount: 1 });
  });

  it("marks only the authenticated user's notifications as read", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);

    const response = await PATCH(
      new Request("https://example.com/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ notificationId: "n_1" }),
      }),
    );

    expect(response.status).toBe(200);
    expect(markAsReadMock).toHaveBeenCalledWith("n_1", "u_1");
  });

  it("marks all notifications for the authenticated user as read", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);

    const response = await PATCH(
      new Request("https://example.com/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ markAllAsRead: true }),
      }),
    );

    expect(response.status).toBe(200);
    expect(markAllAsReadMock).toHaveBeenCalledWith("u_1");
  });

  it("deletes only the authenticated user's notification", async () => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);

    const response = await DELETE(
      new Request("https://example.com/api/notifications?id=n_1", {
        method: "DELETE",
      }),
    );

    expect(response.status).toBe(200);
    expect(deleteNotificationMock).toHaveBeenCalledWith("n_1", "u_1");
  });
});
