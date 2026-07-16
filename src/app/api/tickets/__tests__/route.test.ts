import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    canViewTicket: vi.fn(),
    createTicket: vi.fn(),
    listTickets: vi.fn(),
    addTicketComment: vi.fn(),
    updateTicketStatus: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/ticket/service", () => ({
  canViewTicket: mocks.canViewTicket,
  createTicket: mocks.createTicket,
  listTickets: mocks.listTickets,
  addTicketComment: mocks.addTicketComment,
  updateTicketStatus: mocks.updateTicketStatus,
}));

const route = await import("../route");

const viewerSession = { userId: "u1", username: "alice", roles: ["viewer"], currentTeamId: "team-a" };
const managerSession = { userId: "manager", username: "ops", roles: ["operator"], currentTeamId: "team-a" };

describe("/api/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: viewerSession });
    mocks.requireApiSession.mockResolvedValue(viewerSession);
    mocks.sessionHasPermission.mockImplementation((session, permission) => (
      permission === "ticket:create" || permission === "ticket:read" || session.roles?.includes("operator")
    ));
    mocks.canViewTicket.mockResolvedValue(true);
    mocks.createTicket.mockResolvedValue({ id: "tk1" });
    mocks.listTickets.mockResolvedValue([]);
    mocks.addTicketComment.mockResolvedValue({ id: "comment1" });
    mocks.updateTicketStatus.mockResolvedValue({ id: "tk1", status: "IN_PROGRESS" });
  });

  it("creates tickets with normalized uppercase priority values without requiring ticket management", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Need help", description: "Please check", priority: "high" }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.requireApiPermission).not.toHaveBeenCalled();
    expect(mocks.requireApiSession).toHaveBeenCalled();
    expect(mocks.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      title: "Need help",
      description: "Please check",
      priority: "HIGH",
      createdBy: "u1",
      session: viewerSession,
    }));
  });

  it("lists all tickets for ticket managers", async () => {
    mocks.requireApiPermission.mockResolvedValue({ session: managerSession });

    const response = await route.GET(new Request("http://local/api/tickets"));

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ticket:read");
    expect(mocks.listTickets).toHaveBeenCalledWith({
      userId: "manager",
      includeAll: true,
      session: expect.objectContaining({ userId: "manager" }),
    });
  });

  it("lists only owned or assigned tickets for non-manager readers", async () => {
    const response = await route.GET(new Request("http://local/api/tickets"));

    expect(response.status).toBe(200);
    expect(mocks.listTickets).toHaveBeenCalledWith({
      userId: "u1",
      includeAll: false,
      session: expect.objectContaining({ userId: "u1" }),
    });
  });

  it("updates tickets with normalized uppercase statuses", async () => {
    mocks.requireApiPermission.mockResolvedValue({ session: managerSession });
    const response = await route.PATCH(new Request("http://local/api/tickets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "tk1", status: "in_progress" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateTicketStatus).toHaveBeenCalledWith(expect.objectContaining({
      id: "tk1",
      status: "IN_PROGRESS",
      session: managerSession,
    }));
  });

  it("adds ticket comments without requiring unrelated creation fields", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "tk1", body: " Please update " }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.canViewTicket).toHaveBeenCalledWith("tk1", "u1", viewerSession);
    expect(mocks.addTicketComment).toHaveBeenCalledWith({
      ticketId: "tk1",
      authorId: "u1",
      body: " Please update ",
      session: viewerSession,
    });
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });

  it("rejects malformed ticket POST JSON with the shared bodySchema error envelope", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{not-json",
    }));

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: "Request body is not valid JSON" });
    expect(mocks.createTicket).not.toHaveBeenCalled();
    expect(mocks.addTicketComment).not.toHaveBeenCalled();
  });

  it("blocks comments on tickets the caller cannot access", async () => {
    mocks.canViewTicket.mockResolvedValue(false);

    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "tk2", body: "snoop" }),
    }));

    expect(response.status).toBe(403);
    expect(mocks.addTicketComment).not.toHaveBeenCalled();
  });
});
