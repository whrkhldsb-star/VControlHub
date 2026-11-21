import { describe, expect, it, vi } from "vitest";

const {
  requireApiSessionMock,
  listUserNotificationsMock,
  getUnreadCountMock,
  markAsReadMock,
  markAllAsReadMock,
  deleteNotificationMock,
  auditUserAction,
} = vi.hoisted(() => ({
  requireApiSessionMock: vi.fn(),
  listUserNotificationsMock: vi.fn(),
  getUnreadCountMock: vi.fn(),
  markAsReadMock: vi.fn(),
  markAllAsReadMock: vi.fn(),
  deleteNotificationMock: vi.fn(),
  auditUserAction: vi.fn(),
}));

vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: requireApiSessionMock,

  isSessionPayload: (value: unknown) => Boolean(value),
}));

vi.mock("@/lib/audit/service", () => ({ auditUserAction }));

vi.mock("@/lib/notification/service", () => ({
  listUserNotifications: listUserNotificationsMock,
  getUnreadCount: getUnreadCountMock,
  markAsRead: markAsReadMock,
  markAllAsRead: markAllAsReadMock,
  deleteNotification: deleteNotificationMock,
}));

import { DELETE, GET, PATCH } from "../route";

const session = { userId: "u_1", username: "alice", currentTeamId: "team_1" };

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
    expect(listUserNotificationsMock).toHaveBeenCalledWith(session, {
      limit: 50,
      skip: 0,
    });
    expect(getUnreadCountMock).toHaveBeenCalledWith(session);
    await expect(response.json()).resolves.toMatchObject({ unreadCount: 1 });
  });

  it.each([{ notificationId: "n_1" }, { action: "markAsRead", notificationId: "n_1" }])("marks and audits one notification using %j", async body => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);

    const response = await PATCH(
      new Request("https://example.com/api/notifications", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    expect(markAsReadMock).toHaveBeenCalledWith("n_1", session);
    expect(auditUserAction).toHaveBeenCalledExactlyOnceWith("u_1", "notification.update",
      { scope: "markAsRead", notificationId: "n_1" }, undefined, "team_1");
  });

  it.each([{ markAllAsRead: true }, { action: "markAllAsRead" }])("marks and audits all notifications using %j", async body => {
    vi.clearAllMocks();
    requireApiSessionMock.mockResolvedValueOnce(session);

    const response = await PATCH(
      new Request("https://example.com/api/notifications", {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    );

    expect(response.status).toBe(200);
    expect(markAllAsReadMock).toHaveBeenCalledWith(session);
    expect(auditUserAction).toHaveBeenCalledExactlyOnceWith("u_1", "notification.update",
      { scope: "markAllAsRead" }, undefined, "team_1");
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
    expect(deleteNotificationMock).toHaveBeenCalledWith("n_1", session);
  });
});
