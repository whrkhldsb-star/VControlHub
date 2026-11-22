import { expect, it, vi } from "vitest";
import { listTicketPage } from "@/lib/ticket/query";
import Page from "../page";
import TicketDetailPage from "../[id]/page";
import { requirePagePermission } from "@/lib/auth/page-guard";
import { prisma } from "@/lib/db";

vi.mock("@/lib/auth/page-guard", () => ({
  requirePagePermission: vi.fn().mockResolvedValue({ userId: "reader", roles: [], permissions: ["ticket:read"], currentTeamId: "team" }),
}));
vi.mock("@/lib/ticket/service", () => ({
  getTicketById: vi.fn().mockResolvedValue({ id: "ticket", createdAt: new Date(), updatedAt: new Date(), comments: [] }),
  countTickets: vi.fn().mockResolvedValue({ open: 0, inProgress: 0, resolved: 0, urgent: 0 }),
}));
vi.mock("@/lib/db", () => ({ prisma: { user: { findMany: vi.fn().mockResolvedValue([]) } } }));
vi.mock("@/lib/ticket/query", () => ({
  listTicketPage: vi.fn().mockResolvedValue({ tickets: [], total: 0, page: 1 }),
}));

it("queries the RSC first page with the stored status and priority spellings", async () => {
  await Page({ searchParams: Promise.resolve({ status: "open", priority: "critical" }) });
  expect(listTicketPage).toHaveBeenCalledWith(expect.objectContaining({
    userId: "reader", includeAll: false, query: expect.objectContaining({ status: "OPEN", priority: "URGENT" }),
  }));
});

it("pages and searches all assignable members using the same directory scope", async () => {
  vi.mocked(requirePagePermission).mockResolvedValueOnce({ userId: "manager", username: "manager", roles: [],
    currentTeamId: "team", permissions: ["ticket:manage"], mustChangePassword: false });
  await TicketDetailPage({ params: Promise.resolve({ id: "ticket" }), searchParams: Promise.resolve({ q: "ops_1", usersPage: "2" }) });
  expect(prisma.user.findMany).toHaveBeenCalledWith(expect.objectContaining({
    take: 201, skip: 200, orderBy: [{ username: "asc" }, { id: "asc" }],
    where: { AND: [
      { OR: [{ id: "manager" }, { teamMembership: { is: { teamId: "team" } } }] },
      { OR: [{ username: { contains: "ops\\_1", mode: "insensitive" } }, { displayName: { contains: "ops\\_1", mode: "insensitive" } }] },
    ] },
  }));
});
