import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock, pushUnreadCountMock, pushNotificationMock } = vi.hoisted(() => ({
  prismaMock: {
    notification: {
      create: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    user: {
      findMany: vi.fn(),
    },
    // readUnreadCount: one statement returning the count and its read time.
    $queryRaw: vi.fn(),
  },
  pushUnreadCountMock: vi.fn(),
  pushNotificationMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ws/notification-ws", () => ({
  pushNotification: pushNotificationMock,
  pushUnreadCount: pushUnreadCountMock,
}));

const { announceStoredNotifications, markAsRead, markAllAsRead, deleteNotification, notificationContentData, notifyCommandPending } = await import("../service");
const { setBackgroundCopyLocale } = await import("@/lib/i18n/api-copy");

describe("notification service state synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.notification.count.mockResolvedValue(0);
    let readAt = 0;
    prismaMock.$queryRaw.mockImplementation(async (_sql: TemplateStringsArray, userId: string) => [
      { count: await prismaMock.notification.count({ where: { userId, isRead: false } }), asOfUs: BigInt(++readAt) },
    ]);
  });

  it("pushes unread counts only after mark-as-read persistence completes", async () => {
    let resolveUpdate!: (value: { count: number }) => void;
    const updatePromise = new Promise<{ count: number }>((resolve) => {
      resolveUpdate = resolve;
    });
    prismaMock.notification.updateMany.mockReturnValueOnce(updatePromise);
    prismaMock.notification.count.mockResolvedValueOnce(3);

    const resultPromise = markAsRead("n_1", "u_1");
    await Promise.resolve();

    expect(prismaMock.notification.count).not.toHaveBeenCalled();
    expect(pushUnreadCountMock).not.toHaveBeenCalled();

    resolveUpdate({ count: 1 });
    await expect(resultPromise).resolves.toEqual({ count: 1 });

    expect(prismaMock.notification.count).toHaveBeenCalledWith({
      where: { userId: "u_1", isRead: false },
    });
    expect(pushUnreadCountMock).toHaveBeenCalledWith("u_1", 3, expect.any(Number));
  });

  it("rejects mark-as-read when the notification does not belong to the user", async () => {
    prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 0 });

    await expect(markAsRead("n_missing", "u_1")).rejects.toThrow("通知不存在或无权访问");
    expect(prismaMock.notification.count).not.toHaveBeenCalled();
    expect(pushUnreadCountMock).not.toHaveBeenCalled();
  });

  it("pushes zero unread count only after mark-all persistence completes", async () => {
    let resolveUpdate!: (value: { count: number }) => void;
    const updatePromise = new Promise<{ count: number }>((resolve) => {
      resolveUpdate = resolve;
    });
    prismaMock.notification.updateMany.mockReturnValueOnce(updatePromise);

    const resultPromise = markAllAsRead("u_1");
    await Promise.resolve();

    expect(pushUnreadCountMock).not.toHaveBeenCalled();

    resolveUpdate({ count: 4 });
    await expect(resultPromise).resolves.toEqual({ count: 4 });
    expect(pushUnreadCountMock).toHaveBeenCalledWith("u_1", 0, expect.any(Number));
  });

  it("after mark-all, pushes the count as it is then, not a blanket zero", async () => {
    // A notification created while the update ran is still unread; a late
    // "0" overwrote the badge that had just announced it.
    prismaMock.notification.updateMany.mockResolvedValueOnce({ count: 1 });
    prismaMock.notification.count.mockResolvedValueOnce(1);
    await markAllAsRead("u_1");
    expect(prismaMock.notification.count).toHaveBeenCalledWith({ where: { userId: "u_1", isRead: false } });
    expect(pushUnreadCountMock).toHaveBeenLastCalledWith("u_1", 1, expect.any(Number));
  });

  it("pushes unread counts only after delete persistence completes", async () => {
    let resolveDelete!: (value: { count: number }) => void;
    const deletePromise = new Promise<{ count: number }>((resolve) => {
      resolveDelete = resolve;
    });
    prismaMock.notification.deleteMany.mockReturnValueOnce(deletePromise);
    prismaMock.notification.count.mockResolvedValueOnce(2);

    const resultPromise = deleteNotification("n_1", "u_1");
    await Promise.resolve();

    expect(prismaMock.notification.count).not.toHaveBeenCalled();
    expect(pushUnreadCountMock).not.toHaveBeenCalled();

    resolveDelete({ count: 1 });
    await expect(resultPromise).resolves.toEqual({ count: 1 });
    expect(pushUnreadCountMock).toHaveBeenCalledWith("u_1", 2, expect.any(Number));
  });

  it("rejects delete when the notification does not belong to the user", async () => {
    prismaMock.notification.deleteMany.mockResolvedValueOnce({ count: 0 });

    await expect(deleteNotification("n_missing", "u_1")).rejects.toThrow("通知不存在或无权访问");
    expect(prismaMock.notification.count).not.toHaveBeenCalled();
    expect(pushUnreadCountMock).not.toHaveBeenCalled();
  });

  it("notifyCommandPending notifies administrators and the customer's approvers when teamId set", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: "a1" }, { id: "a2" }]);
    prismaMock.notification.create.mockImplementation(async ({ data }: any) => ({ id: "n", ...data, createdAt: new Date() }));
    prismaMock.notification.count.mockResolvedValue(0);

    await notifyCommandPending("requester", "reboot edge", "team_a");

    expect(prismaMock.user.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [
            { roles: { some: { role: { key: "admin" } } } },
            { teamMembership: { is: { teamId: "team_a", team: { deletedAt: null }, identityTemplate: { permissions: { has: "command:approve" } } } } },
          ],
        }),
      }),
    );
  });

  it("notifyCommandPending restricts null-team requests to platform administrators", async () => {
    prismaMock.user.findMany.mockResolvedValueOnce([{ id: "a1" }]);
    prismaMock.notification.create.mockImplementation(async ({ data }: any) => ({ id: "n", ...data, createdAt: new Date() }));
    prismaMock.notification.count.mockResolvedValue(0);

    await notifyCommandPending("requester", "reboot edge", null);

    const where = prismaMock.user.findMany.mock.calls.at(-1)![0].where;
    // No broadcast to any customer's approvers; only platform administrators.
    expect(where.OR).toBeUndefined();
    expect(where.roles).toEqual({ some: { role: { key: "admin" } } });
  });

  it("stores the fallback text in the process's language", () => {
    // The text a reader sees when it cannot be rendered from the code (an API
    // client, an older page). The worker wrote it in Chinese on any platform.
    const notice = { code: "ticketSlaEscalated" as const, params: { title: "Disk", fromKey: "ticketsDetail.priority.NORMAL", toKey: "ticketsDetail.priority.HIGH" } };
    const chinese = notificationContentData({ notice });
    setBackgroundCopyLocale("en");
    try {
      const english = notificationContentData({ notice });
      expect(english.messageCode).toBe("ticketSlaEscalated");
      expect(english.title).not.toBe(chinese.title);
      expect(english.title).toMatch(/[A-Za-z]{4}/);
      expect(english.title).not.toMatch(/[\u4e00-\u9fff]/);
    } finally {
      setBackgroundCopyLocale(undefined);
    }
    expect(chinese.title).toMatch(/[\u4e00-\u9fff]/);
  });

  describe("rows stored without createNotification", () => {
    // The bell shows the toast and the badge from pushes while its socket is
    // connected: a row nobody announced stayed invisible until the next reload.
    const at = new Date("2026-11-11T00:00:00Z");
    const row = (id: string, userId: string) => ({
      id,
      userId,
      title: `title ${id}`,
      message: `message ${id}`,
      messageCode: "ticketSlaEscalated",
      messageParams: { title: id },
      actionUrl: `/tickets/${id}`,
      teamId: "team_a",
      createdAt: at,
    });

    it("announces every row, and each recipient's unread count once", async () => {
      prismaMock.notification.count.mockResolvedValue(2);

      await announceStoredNotifications([row("n1", "u1"), row("n2", "u2"), row("n3", "u1")]);

      expect(pushNotificationMock).toHaveBeenCalledTimes(3);
      expect(pushNotificationMock).toHaveBeenCalledWith("u1", {
        id: "n1",
        title: "title n1",
        message: "message n1",
        messageCode: "ticketSlaEscalated",
        messageParams: { title: "n1" },
        actionUrl: "/tickets/n1",
        teamId: "team_a",
        createdAt: at.toISOString(),
      });
      expect(pushNotificationMock).toHaveBeenCalledWith("u2", expect.objectContaining({ id: "n2" }));
      expect(pushNotificationMock).toHaveBeenCalledWith("u1", expect.objectContaining({ id: "n3" }));
      expect(pushUnreadCountMock).toHaveBeenCalledTimes(2);
      expect(pushUnreadCountMock).toHaveBeenCalledWith("u1", 2, expect.any(Number));
      expect(pushUnreadCountMock).toHaveBeenCalledWith("u2", 2, expect.any(Number));
    });

    it("reads nothing when there is nothing to announce", async () => {
      await announceStoredNotifications([]);
      expect(prismaMock.$queryRaw).not.toHaveBeenCalled();
      expect(pushNotificationMock).not.toHaveBeenCalled();
    });

    it("keeps announcing the others when one recipient cannot be reached", async () => {
      pushNotificationMock.mockImplementationOnce(() => {
        throw new Error("bus down");
      });

      await announceStoredNotifications([row("n1", "u1"), row("n2", "u2")]);

      expect(pushNotificationMock).toHaveBeenCalledWith("u2", expect.objectContaining({ id: "n2" }));
      expect(pushUnreadCountMock).toHaveBeenCalledWith("u2", 0, expect.any(Number));
    });

    it("never fails the caller: the rows are stored whatever happens to the push", async () => {
      prismaMock.$queryRaw.mockRejectedValueOnce(new Error("database unavailable"));

      await expect(announceStoredNotifications([row("n1", "u1")])).resolves.toBeUndefined();

      expect(pushUnreadCountMock).not.toHaveBeenCalled();
    });
  });

});
