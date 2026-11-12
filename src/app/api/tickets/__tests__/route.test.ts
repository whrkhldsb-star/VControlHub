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
    listTicketPage: vi.fn(),
    listTicketBoard: vi.fn(),
    listTicketsAdvanced: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession ,
  isSessionPayload: (value: unknown) => Boolean(value),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/ticket/service", () => ({
  canViewTicket: mocks.canViewTicket,
  createTicket: mocks.createTicket,
  listTickets: mocks.listTickets,
  addTicketComment: mocks.addTicketComment,
  updateTicketStatus: mocks.updateTicketStatus,
}));

vi.mock("@/lib/ticket/query", () => ({ listTicketPage: mocks.listTicketPage, listTicketBoard: mocks.listTicketBoard }));
vi.mock("@/lib/ticket/sla", () => ({ listTicketsAdvanced: mocks.listTicketsAdvanced, getTicketKanban: vi.fn() }));

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
    mocks.listTicketPage.mockResolvedValue({ tickets: [], total: 0, page: 1, pageSize: 20 });
    mocks.listTicketBoard.mockResolvedValue([]);
    mocks.listTicketsAdvanced.mockResolvedValue([]);
  });

  it("creates tickets with normalized uppercase priority values without requiring ticket management", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Need help", description: "Please check", priority: "high" }),
    }));

    expect(response.status).toBe(201);
    // POST declares the single `ticket:create` permission: enforced through
    // requireApiPermission (managers without ticket:create no longer slip
    // past the guard only to hit an inner 403).
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ticket:create");
    expect(mocks.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      title: "Need help",
      description: "Please check",
      priority: "HIGH",
      createdBy: "u1",
      session: viewerSession,
    }));
  });

  it.each(["critical", "CRITICAL"])("files %s as URGENT, the level its SLA knows", async (priority) => {
    // Stored as CRITICAL, no SLA rule matched and it got the 24 h default.
    await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Outage", description: "Down", priority }),
    }));
    expect(mocks.createTicket).toHaveBeenLastCalledWith(expect.objectContaining({ priority: "URGENT" }));
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

  // The list's own update had a priority list of its own, without the product's highest level: raising a
  // ticket to urgent from the list was refused (400) while the ticket's page accepted it.
  it.each([
    ["urgent", "URGENT"],
    ["URGENT", "URGENT"],
    ["critical", "URGENT"],
    ["medium", "NORMAL"],
  ])("accepts priority %s on the collection update, as the ticket's own route does", async (priority, stored) => {
    mocks.requireApiPermission.mockResolvedValue({ session: managerSession });
    const response = await route.PATCH(new Request("http://local/api/tickets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "tk1", status: "open", priority }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateTicketStatus).toHaveBeenCalledWith(expect.objectContaining({ id: "tk1", priority: stored }));
  });

  // A filter was only upper-cased: "medium" and "critical", which the API takes when a ticket is filed,
  // matched nothing because they are stored as NORMAL and URGENT.
  it.each([
    ["medium", "NORMAL"],
    ["critical", "URGENT"],
    ["high", "HIGH"],
  ])("filters by priority %s as it is stored", async (priority, stored) => {
    await route.GET(new Request(`http://local/api/tickets?page=1&priority=${priority}`));
    expect(mocks.listTicketPage).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ priority: stored }) }));

    await route.GET(new Request(`http://local/api/tickets?view=board&priority=${priority}`));
    expect(mocks.listTicketBoard).toHaveBeenCalledWith(expect.objectContaining({ query: expect.objectContaining({ priority: stored }) }));

    await route.GET(new Request(`http://local/api/tickets?priority=${priority}`));
    expect(mocks.listTicketsAdvanced).toHaveBeenCalledWith(expect.objectContaining({ priority: stored }));
  });

  it("rejects collection-route comment payloads (comments live on /api/tickets/[id])", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "tk1", body: " Please update " }),
    }));

    expect(response.status).toBe(400);
    expect(mocks.addTicketComment).not.toHaveBeenCalled();
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

  it("does not accept ticketId comment bodies on the collection create route", async () => {
    mocks.canViewTicket.mockResolvedValue(false);

    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "tk2", body: "snoop" }),
    }));

    // Collection POST is create-only; invalid create payload → validation 400 (not comment ACL).
    expect(response.status).toBe(400);
    expect(mocks.addTicketComment).not.toHaveBeenCalled();
  });
});
