import { describe, expect, it, vi, beforeEach } from "vitest";
const { mockPrisma } = vi.hoisted(() => ({
  mockPrisma: {
    ticket: {
      create: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    ticketComment: { create: vi.fn() },
    server: { findFirst: vi.fn() },
    commandRequest: { findFirst: vi.fn() },
    teamMember: { findUnique: vi.fn() },
    itsmConnection: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));
vi.mock("@/lib/db", () => ({ prisma: mockPrisma }));
vi.mock("@/lib/itsm/service", () => ({
  safeFanOutTicketEvent: vi.fn(async () => undefined),
  fanOutTicketEvent: vi.fn(async () => ({ sent: 0, failed: 0 })),
}));
vi.mock("@/lib/auth/authorization", () => ({
  sessionHasPermission: (session: { roles?: string[] }, permission: string) =>
    permission === "team:manage" && session.roles?.includes("admin"),
}));
const { createTicket, updateTicketStatus, addTicketComment, canViewTicket, listTickets, getTicketById } = await import("./service");

const teamSession = { userId: "u1", roles: ["operator"] as never[], currentTeamId: "team-a" };
const adminSession = { userId: "admin", roles: ["admin"] as never[], currentTeamId: "team-a" };

describe("ticket service", () => {
  beforeEach(() => vi.clearAllMocks());
  it("creates tickets and validates status transitions", async () => {
    mockPrisma.ticket.create.mockImplementation(async ({ data }: any) => ({ id: "tk1", ...data }));
    const ticket = await createTicket({ title: "Need VPS", description: "Please add node", createdBy: "u1" });
    expect(ticket.status).toBe("OPEN");
    await expect(updateTicketStatus({ id: "tk1", status: "BAD" })).rejects.toThrow(/状态无效|status is invalid/);
  });

  it("rejects related server outside team scope on create", async () => {
    mockPrisma.server.findFirst.mockResolvedValueOnce(null);
    await expect(
      createTicket({
        title: "Need VPS",
        description: "Please add node",
        createdBy: "u1",
        relatedServerId: "srv-foreign",
        session: teamSession,
      }),
    ).rejects.toThrow(/关联服务器不存在|Related server not found/);
    expect(mockPrisma.ticket.create).not.toHaveBeenCalled();
    expect(mockPrisma.server.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "srv-foreign",
          OR: [{ teamId: "team-a" }, { teamId: null }],
        },
      }),
    );
  });

  it("rejects related command outside team scope on create", async () => {
    mockPrisma.commandRequest.findFirst.mockResolvedValueOnce(null);
    await expect(
      createTicket({
        title: "Need VPS",
        description: "Please add node",
        createdBy: "u1",
        relatedCommandId: "cmd-foreign",
        session: teamSession,
      }),
    ).rejects.toThrow(/关联命令请求不存在|Related command/);
    expect(mockPrisma.ticket.create).not.toHaveBeenCalled();
  });

  it("accepts related server under team scope on create", async () => {
    mockPrisma.server.findFirst.mockResolvedValueOnce({ id: "srv1" });
    mockPrisma.ticket.create.mockImplementation(async ({ data }: any) => ({ id: "tk1", ...data }));
    await createTicket({
      title: "Need VPS",
      description: "Please add node",
      createdBy: "u1",
      relatedServerId: "srv1",
      session: teamSession,
    });
    expect(mockPrisma.ticket.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ relatedServerId: "srv1", teamId: "team-a" }),
      }),
    );
  });

  it("updates assignee without requiring a status change", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ id: "tk1", teamId: null });
    mockPrisma.ticket.update.mockResolvedValueOnce({ id: "tk1", status: "OPEN", assigneeId: "u2" });

    await updateTicketStatus({ id: "tk1", assigneeId: "u2" });

    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { assigneeId: "u2" },
    });
  });

  it("rejects assignee outside ticket team when session is present", async () => {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce({ teamId: "team-a" });
    mockPrisma.teamMember.findUnique.mockResolvedValueOnce(null);

    await expect(
      updateTicketStatus({ id: "tk1", assigneeId: "foreign-user", session: teamSession }),
    ).rejects.toThrow(/不是当前团队成员|not a member of this team/);
    expect(mockPrisma.ticket.updateMany).not.toHaveBeenCalled();
  });

  it("allows self-assignment without membership lookup", async () => {
    mockPrisma.ticket.findFirst
      .mockResolvedValueOnce({ teamId: "team-a" })
      .mockResolvedValueOnce({ id: "tk1", assigneeId: "u1", title: "t", description: "d", status: "OPEN", priority: "NORMAL", category: null, teamId: "team-a" });
    mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });

    await updateTicketStatus({ id: "tk1", assigneeId: "u1", session: teamSession });

    expect(mockPrisma.teamMember.findUnique).not.toHaveBeenCalled();
    expect(mockPrisma.ticket.updateMany).toHaveBeenCalled();
  });

  it("preserves assignee when status changes omit assigneeId and clears assignee only for explicit null", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValue({ id: "tk1", status: "OPEN", teamId: null });
    mockPrisma.ticket.update.mockResolvedValue({ id: "tk1" });
    mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });

    await updateTicketStatus({ id: "tk1", status: "IN_PROGRESS" });
    await updateTicketStatus({ id: "tk1", assigneeId: null });

    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
      where: { id: "tk1", status: "OPEN" },
      data: { status: "IN_PROGRESS", closedAt: null },
    });
    expect(mockPrisma.ticket.update).toHaveBeenCalledWith({
      where: { id: "tk1" },
      data: { assigneeId: null },
    });
  });

  it("rejects invalid status transitions (state machine)", async () => {
    // OPEN → CLOSED is not a valid transition (must go through IN_PROGRESS→RESOLVED→CLOSED)
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ id: "tk1", status: "OPEN", teamId: null });
    await expect(updateTicketStatus({ id: "tk1", status: "CLOSED" })).rejects.toThrow();

    // CLOSED → IN_PROGRESS is not valid (only CLOSED → OPEN)
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ id: "tk1", status: "CLOSED", teamId: null });
    await expect(updateTicketStatus({ id: "tk1", status: "IN_PROGRESS" })).rejects.toThrow();

    // RESOLVED → OPEN is not valid
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ id: "tk1", status: "RESOLVED", teamId: null });
    await expect(updateTicketStatus({ id: "tk1", status: "OPEN" })).rejects.toThrow();

    // update should not have been called for any of the rejected transitions
    expect(mockPrisma.ticket.update).not.toHaveBeenCalled();
  });

  it("accepts valid status transitions", async () => {
    mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });
    // OPEN → IN_PROGRESS (valid)
    mockPrisma.ticket.findUnique
      .mockResolvedValueOnce({ id: "tk1", status: "OPEN", teamId: null })
      .mockResolvedValueOnce({ id: "tk1", status: "IN_PROGRESS" });
    mockPrisma.ticket.update.mockResolvedValueOnce({ id: "tk1", status: "IN_PROGRESS" });
    await updateTicketStatus({ id: "tk1", status: "IN_PROGRESS" });
    expect(mockPrisma.ticket.updateMany).toHaveBeenLastCalledWith({
      where: { id: "tk1", status: "OPEN" },
      data: { status: "IN_PROGRESS", closedAt: null },
    });

    // IN_PROGRESS → RESOLVED (valid)
    mockPrisma.ticket.findUnique
      .mockResolvedValueOnce({ id: "tk1", status: "IN_PROGRESS", teamId: null })
      .mockResolvedValueOnce({ id: "tk1", status: "RESOLVED" });
    mockPrisma.ticket.update.mockResolvedValueOnce({ id: "tk1", status: "RESOLVED" });
    await updateTicketStatus({ id: "tk1", status: "RESOLVED" });

    // RESOLVED → CLOSED (valid, sets closedAt)
    mockPrisma.ticket.findUnique
      .mockResolvedValueOnce({ id: "tk1", status: "RESOLVED", teamId: null })
      .mockResolvedValueOnce({ id: "tk1", status: "CLOSED" });
    mockPrisma.ticket.update.mockResolvedValueOnce({ id: "tk1", status: "CLOSED" });
    await updateTicketStatus({ id: "tk1", status: "CLOSED" });
    expect(mockPrisma.ticket.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "CLOSED", closedAt: expect.any(Date) }) }),
    );

    // CLOSED → OPEN (re-open, valid, clears closedAt)
    mockPrisma.ticket.findUnique
      .mockResolvedValueOnce({ id: "tk1", status: "CLOSED", teamId: null })
      .mockResolvedValueOnce({ id: "tk1", status: "OPEN" });
    mockPrisma.ticket.update.mockResolvedValueOnce({ id: "tk1", status: "OPEN" });
    await updateTicketStatus({ id: "tk1", status: "OPEN" });
    expect(mockPrisma.ticket.updateMany).toHaveBeenLastCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: "OPEN", closedAt: null }) }),
    );
  });

  it("adds non-empty comments", async () => {
    await expect(addTicketComment({ ticketId: "tk1", authorId: "u1", body: "  " })).rejects.toThrow(/不能为空|cannot be empty/);
  });

  it("returns comment authors for newly added comments", async () => {
    mockPrisma.ticketComment.create.mockResolvedValueOnce({ id: "c1", author: { id: "u1", username: "alice", displayName: null } });

    await addTicketComment({ ticketId: "tk1", authorId: "u1", body: " please check " });

    expect(mockPrisma.ticketComment.create).toHaveBeenCalledWith({
      data: { ticketId: "tk1", authorId: "u1", body: "please check" },
      include: { author: { select: { id: true, username: true, displayName: true } } },
    });
  });

  it("allows creators and assignees to view their own ticket", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ createdBy: "u1", assigneeId: null });
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ createdBy: "u2", assigneeId: "u1" });
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ createdBy: "u2", assigneeId: null });

    await expect(canViewTicket("tk1", "u1")).resolves.toBe(true);
    await expect(canViewTicket("tk2", "u1")).resolves.toBe(true);
    await expect(canViewTicket("tk3", "u1")).resolves.toBe(false);
  });

  it("lists all tickets only when includeAll is explicit", async () => {
    mockPrisma.ticket.findMany.mockResolvedValue([]);

    await listTickets({ userId: "u1", includeAll: false });
    await listTickets({ userId: "u1", includeAll: true });

    expect(mockPrisma.ticket.findMany).toHaveBeenNthCalledWith(1, expect.objectContaining({
      where: { OR: [{ createdBy: "u1" }, { assigneeId: "u1" }] },
    }));
    expect(mockPrisma.ticket.findMany).toHaveBeenNthCalledWith(2, expect.objectContaining({
      where: {},
    }));
  });

  it("scopes getTicketById with teamWhere for non-admin sessions", async () => {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce({ id: "tk1", teamId: "team-a", title: "A" });

    await getTicketById("tk1", teamSession);

    expect(mockPrisma.ticket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "tk1",
          OR: [{ teamId: "team-a" }, { teamId: null }],
        },
      }),
    );
    expect(mockPrisma.ticket.findUnique).not.toHaveBeenCalled();
  });

  it("keeps getTicketById unscoped without session (system path)", async () => {
    mockPrisma.ticket.findUnique.mockResolvedValueOnce({ id: "tk1", title: "A" });

    await getTicketById("tk1");

    expect(mockPrisma.ticket.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { id: "tk1" } }));
  });

  it("scopes canViewTicket with teamWhere so foreign-team tickets are invisible", async () => {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce(null);

    await expect(canViewTicket("tk-other", "u1", teamSession)).resolves.toBe(false);
    expect(mockPrisma.ticket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: "tk-other",
          OR: [{ teamId: "team-a" }, { teamId: null }],
        },
      }),
    );
  });

  it("scopes updateTicketStatus mutations with teamWhere", async () => {
    mockPrisma.ticket.findFirst
      .mockResolvedValueOnce({ id: "tk1", status: "OPEN", teamId: "team-a" })
      .mockResolvedValueOnce({ id: "tk1", status: "IN_PROGRESS", title: "t", description: "d", priority: "NORMAL", category: null, teamId: "team-a" });
    mockPrisma.ticket.updateMany.mockResolvedValue({ count: 1 });

    await updateTicketStatus({ id: "tk1", status: "IN_PROGRESS", session: teamSession });

    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith({
      where: {
        id: "tk1",
        status: "OPEN",
        OR: [{ teamId: "team-a" }, { teamId: null }],
      },
      data: { status: "IN_PROGRESS", closedAt: null },
    });
  });

  it("throws NotFound when updateTicketStatus targets a foreign-team ticket", async () => {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce(null);

    await expect(updateTicketStatus({ id: "tk-x", status: "IN_PROGRESS", session: teamSession })).rejects.toThrow(
      /工单不存在|Ticket not found/,
    );
  });

  it("guards addTicketComment with team-scoped existence check", async () => {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce(null);

    await expect(
      addTicketComment({ ticketId: "tk-x", authorId: "u1", body: "hi", session: teamSession }),
    ).rejects.toThrow(/工单不存在|Ticket not found/);
    expect(mockPrisma.ticketComment.create).not.toHaveBeenCalled();
  });

  it("admin session does not apply team filter on getTicketById", async () => {
    mockPrisma.ticket.findFirst.mockResolvedValueOnce({ id: "tk1" });

    await getTicketById("tk1", adminSession);

    expect(mockPrisma.ticket.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "tk1" },
      }),
    );
  });

  it("recomputes slaDueAt when priority changes on an open ticket", async () => {
    mockPrisma.ticket.findFirst
      .mockResolvedValueOnce({ status: "OPEN", teamId: "team_a" })
      .mockResolvedValueOnce({ createdAt: new Date("2026-01-01T00:00:00Z"), status: "OPEN" })
      .mockResolvedValueOnce({
        id: "tk1",
        status: "IN_PROGRESS",
        priority: "URGENT",
        slaDueAt: new Date("2026-01-01T02:00:00Z"),
        teamId: "team_a",
        title: "t",
        description: "d",
        category: null,
      });
    mockPrisma.ticket.updateMany.mockResolvedValueOnce({ count: 1 });
    const session = { userId: "u1", roles: ["admin"] as any, currentTeamId: "team_a" };
    const updated = await updateTicketStatus({
      id: "tk1",
      status: "IN_PROGRESS",
      priority: "URGENT",
      session,
      skipItsmFanOut: true,
    });
    expect(mockPrisma.ticket.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          status: "IN_PROGRESS",
          priority: "URGENT",
          slaDueAt: new Date("2026-01-01T02:00:00Z"),
          escalatedAt: null,
        }),
      }),
    );
    expect(updated.priority).toBe("URGENT");
  });

});
