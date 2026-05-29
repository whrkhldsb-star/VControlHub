import { beforeEach, describe, expect, it, vi } from "vitest";

const { mocks } = vi.hoisted(() => ({
  mocks: {
    requireApiPermission: vi.fn(),
    createTicket: vi.fn(),
    listTickets: vi.fn(),
    addTicketComment: vi.fn(),
    updateTicketStatus: vi.fn(),
  },
}));

vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requireApiPermission }));
vi.mock("@/lib/ticket/service", () => ({
  createTicket: mocks.createTicket,
  listTickets: mocks.listTickets,
  addTicketComment: mocks.addTicketComment,
  updateTicketStatus: mocks.updateTicketStatus,
}));

const route = await import("../route");

describe("/api/tickets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireApiPermission.mockResolvedValue({ session: { userId: "u1", username: "alice" } });
    mocks.createTicket.mockResolvedValue({ id: "tk1" });
    mocks.listTickets.mockResolvedValue([]);
    mocks.addTicketComment.mockResolvedValue({ id: "comment1" });
    mocks.updateTicketStatus.mockResolvedValue({ id: "tk1", status: "IN_PROGRESS" });
  });

  it("creates tickets with normalized uppercase priority values", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ subject: "Need help", description: "Please check", priority: "high" }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.createTicket).toHaveBeenCalledWith(expect.objectContaining({
      title: "Need help",
      description: "Please check",
      priority: "HIGH",
      createdBy: "u1",
    }));
  });

  it("updates tickets with normalized uppercase statuses", async () => {
    const response = await route.PATCH(new Request("http://local/api/tickets", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: "tk1", status: "in_progress" }),
    }));

    expect(response.status).toBe(200);
    expect(mocks.updateTicketStatus).toHaveBeenCalledWith(expect.objectContaining({
      id: "tk1",
      status: "IN_PROGRESS",
    }));
  });

  it("adds ticket comments without requiring unrelated creation fields", async () => {
    const response = await route.POST(new Request("http://local/api/tickets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ticketId: "tk1", body: " Please update " }),
    }));

    expect(response.status).toBe(201);
    expect(mocks.addTicketComment).toHaveBeenCalledWith({ ticketId: "tk1", authorId: "u1", body: " Please update " });
    expect(mocks.createTicket).not.toHaveBeenCalled();
  });
});
