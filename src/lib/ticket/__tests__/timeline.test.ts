import { beforeEach, describe, expect, it, vi } from "vitest";

const { prismaMock } = vi.hoisted(() => ({
  prismaMock: {
    ticket: {
      findUnique: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
    },
    ticketEscalation: { create: vi.fn() },
    commandRequest: { findUnique: vi.fn() },
    server: { findUnique: vi.fn() },
  },
}));

vi.mock("@/lib/db", () => ({ prisma: prismaMock }));

import { getTicketTimeline, linkTicketCommand } from "../timeline";

describe("ticket timeline", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("merges ticket and command events chronologically", async () => {
    const t0 = new Date("2026-07-01T10:00:00Z");
    const t1 = new Date("2026-07-01T10:05:00Z");
    const t2 = new Date("2026-07-01T10:10:00Z");
    prismaMock.ticket.findUnique.mockResolvedValue({
      id: "tk1",
      title: "Need restart",
      status: "IN_PROGRESS",
      priority: "HIGH",
      createdAt: t0,
      closedAt: null,
      relatedServerId: null,
      relatedCommandId: "cmd1",
      creator: { username: "alice", displayName: "Alice" },
      assignee: null,
      comments: [
        {
          id: "c1",
          body: "please approve",
          createdAt: t1,
          author: { username: "alice", displayName: "Alice" },
        },
      ],
      escalations: [],
    });
    prismaMock.commandRequest.findUnique.mockResolvedValue({
      id: "cmd1",
      title: "restart nginx",
      command: "systemctl restart nginx",
      status: "COMPLETED",
      createdAt: t0,
      updatedAt: t2,
      requester: { username: "bob", displayName: null },
      approvals: [
        {
          id: "a1",
          approved: true,
          comment: "ok",
          createdAt: t1,
          approver: { username: "admin", displayName: "Admin" },
        },
      ],
      executionLogs: [
        { id: "l1", summary: "started", createdAt: t1, serverId: "s1" },
      ],
      targets: [
        {
          id: "tg1",
          serverId: "s1",
          status: "COMPLETED",
          exitCode: 0,
          stdout: "ok",
          stderr: null,
          startedAt: t1,
          finishedAt: t2,
          server: { id: "s1", name: "edge", host: "1.2.3.4" },
        },
      ],
    });
    prismaMock.ticket.findMany.mockResolvedValue([]);

    const result = await getTicketTimeline("tk1");
    expect(result.events.length).toBeGreaterThan(3);
    const times = result.events.map((e) => new Date(e.at).getTime());
    expect([...times].sort((a, b) => a - b)).toEqual(times);
    expect(result.related.command?.id).toBe("cmd1");
    expect(result.events.some((e) => e.type === "command.approval")).toBe(true);
    expect(result.events.some((e) => e.type === "ticket.comment")).toBe(true);
  });

  it("links command and writes escalation audit", async () => {
    prismaMock.ticket.findUnique.mockResolvedValue({
      id: "tk1",
      relatedCommandId: null,
      status: "OPEN",
    });
    prismaMock.commandRequest.findUnique.mockResolvedValue({
      id: "cmd9",
      title: "x",
      status: "PENDING_APPROVAL",
    });
    prismaMock.ticket.update.mockResolvedValue({ id: "tk1", relatedCommandId: "cmd9" });
    prismaMock.ticketEscalation.create.mockResolvedValue({});

    await linkTicketCommand({
      ticketId: "tk1",
      commandRequestId: "cmd9",
      actorId: "u1",
    });
    expect(prismaMock.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { relatedCommandId: "cmd9" },
    });
    expect(prismaMock.ticketEscalation.create).toHaveBeenCalled();
  });
});
