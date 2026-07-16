import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    requireApiSession: vi.fn(),
    sessionHasPermission: vi.fn(),
    canViewTicket: vi.fn(),
    getTicketById: vi.fn(),
    updateTicketStatus: vi.fn(),
    addTicketComment: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/auth/api-session", () => ({ requireApiSession: mocks.requireApiSession }));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: mocks.sessionHasPermission }));
vi.mock("@/lib/ticket/service", () => ({
  canViewTicket: mocks.canViewTicket,
  getTicketById: mocks.getTicketById,
  updateTicketStatus: mocks.updateTicketStatus,
  addTicketComment: mocks.addTicketComment,
}));

const route = await import("../[id]/route");

function params(id = "tk1") {
  return { params: Promise.resolve({ id }) };
}

const viewerSession = { userId: "u1", username: "alice", roles: ["viewer"], currentTeamId: "team-a" };
const adminSession = { userId: "admin", username: "root", roles: ["operator"], currentTeamId: "team-a" };

describe("/api/tickets/[id]", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiSession.mockResolvedValue(viewerSession);
    mocks.requireApiPermission.mockResolvedValue({ session: adminSession });
    mocks.sessionHasPermission.mockReturnValue(false);
    mocks.canViewTicket.mockResolvedValue(true);
    mocks.getTicketById.mockResolvedValue({ id: "tk1", title: "Need help" });
    mocks.updateTicketStatus.mockResolvedValue({ id: "tk1", status: "RESOLVED" });
    mocks.addTicketComment.mockResolvedValue({ id: "comment1", body: "done" });
  });

  it("allows ticket participants to view their ticket", async () => {
    const response = await route.GET(new Request("http://local/api/tickets/tk1"), params());

    expect(response.status).toBe(200);
    expect(mocks.canViewTicket).toHaveBeenCalledWith("tk1", "u1", viewerSession);
    expect(mocks.getTicketById).toHaveBeenCalledWith("tk1", viewerSession);
    await expect(response.json()).resolves.toEqual({ ticket: { id: "tk1", title: "Need help" } });
  });

  it("blocks users who are neither managers nor participants", async () => {
    mocks.canViewTicket.mockResolvedValue(false);

    const response = await route.GET(new Request("http://local/api/tickets/tk1"), params());

    // Team-scoped load runs first; missing ticket or no participant access → 403/404.
    expect(mocks.getTicketById).toHaveBeenCalledWith("tk1", viewerSession);
    expect(response.status).toBe(403);
  });

  it("requires ticket management permission for status updates", async () => {
    const response = await route.PATCH(new Request("http://local/api/tickets/tk1", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      // TR-037: zod schema enforces canonical uppercase status enum.
      body: JSON.stringify({ status: "RESOLVED" }),
    }), params());

    expect(response.status).toBe(200);
    expect(mocks.requireApiPermission).toHaveBeenCalledWith("ticket:manage");
    expect(mocks.updateTicketStatus).toHaveBeenCalledWith({
      id: "tk1",
      status: "RESOLVED",
      session: adminSession,
    });
  });

  it("allows ticket participants to add comments", async () => {
    const response = await route.POST(new Request("http://local/api/tickets/tk1", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ body: " please check " }),
    }), params());

    expect(response.status).toBe(201);
    expect(mocks.addTicketComment).toHaveBeenCalledWith({
      ticketId: "tk1",
      authorId: "u1",
      body: "please check",
      session: viewerSession,
    });
  });
});
