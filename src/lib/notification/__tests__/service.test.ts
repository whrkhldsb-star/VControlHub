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
  },
  pushUnreadCountMock: vi.fn(),
  pushNotificationMock: vi.fn(),
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));
vi.mock("@/lib/ws/notification-ws", () => ({
  pushNotification: pushNotificationMock,
  pushUnreadCount: pushUnreadCountMock,
}));

const { markAsRead, markAllAsRead, deleteNotification } = await import("../service");

describe("notification service state synchronization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    prismaMock.notification.count.mockResolvedValue(0);
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
    expect(pushUnreadCountMock).toHaveBeenCalledWith("u_1", 3);
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
    expect(pushUnreadCountMock).toHaveBeenCalledWith("u_1", 0);
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
    expect(pushUnreadCountMock).toHaveBeenCalledWith("u_1", 2);
  });
});
