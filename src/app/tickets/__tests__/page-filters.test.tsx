import { expect, it, vi } from "vitest";
import { listTicketPage } from "@/lib/ticket/query";
import Page from "../page";

vi.mock("@/lib/auth/page-guard", () => ({
  requirePagePermission: vi.fn().mockResolvedValue({ userId: "reader", roles: [], permissions: ["ticket:read"], currentTeamId: "team" }),
}));
vi.mock("@/lib/ticket/service", () => ({
  countTickets: vi.fn().mockResolvedValue({ open: 0, inProgress: 0, resolved: 0, urgent: 0 }),
}));
vi.mock("@/lib/ticket/query", () => ({
  listTicketPage: vi.fn().mockResolvedValue({ tickets: [], total: 0, page: 1 }),
}));

it("queries the RSC first page with the stored status and priority spellings", async () => {
  await Page({ searchParams: Promise.resolve({ status: "open", priority: "critical" }) });
  expect(listTicketPage).toHaveBeenCalledWith(expect.objectContaining({
    userId: "reader", includeAll: false, query: expect.objectContaining({ status: "OPEN", priority: "URGENT" }),
  }));
});
