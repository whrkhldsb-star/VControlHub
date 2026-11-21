import { expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ installed: vi.fn() }));
vi.mock("@/lib/auth/api-session", () => ({
  requireApiSession: async () => ({ userId: "viewer", roles: ["operator"], currentTeamId: "team" }),
  isSessionPayload: (session: unknown) => Boolean(session),
}));
vi.mock("@/lib/auth/authorization", () => ({ sessionHasPermission: (_: unknown, permission: string) => permission === "docker:manage" }));
vi.mock("@/lib/db", () => ({ prisma: { quickService: { findMany: mocks.installed } } }));
vi.mock("../catalog", () => ({ SERVICE_CATALOG: [{ slug: "ghost", name: "Ghost", description: "Blog" }] }));
vi.mock("../app-source-sync", () => ({ getRemoteApps: async () => [] }));
import { GET } from "@/app/api/search/route";

it.each(["running", "server-501"])("finds the installed instance by %s even when its slug is in the catalogue", async query => {
  const row = { slug: "ghost", name: "Hosted Ghost", instanceKey: "server-501", status: "running", description: "Blog" };
  mocks.installed.mockResolvedValue([row]);
  const response = await GET(new Request("http://local/api/search?q=" + query));
  expect(await response.json()).toMatchObject({ results: [{ id: "quick-service:ghost", label: "Hosted Ghost" }] });
  expect(mocks.installed).toHaveBeenCalledWith(expect.objectContaining({ take: 8, where: {
    AND: [{ OR: expect.arrayContaining([{ instanceKey: { contains: query, mode: "insensitive" } }, { status: { contains: query, mode: "insensitive" } }]) }],
    OR: [{ server: expect.objectContaining({ AND: expect.arrayContaining([{ teamId: "team" }]) }) }],
  } }));
});

it("matches a query spanning the displayed status and instance name before limiting the results", async () => {
  mocks.installed.mockResolvedValue([{ slug: "ghost", name: "Hosted Ghost", description: "Blog" }]);
  const response = await GET(new Request("http://local/api/search?q=ing%40server-5"));
  expect(await response.json()).toMatchObject({ results: [{ id: "quick-service:ghost", label: "Hosted Ghost" }] });
  expect(mocks.installed).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
    AND: [{ OR: expect.arrayContaining([{
      status: { endsWith: "ing", mode: "insensitive" },
      instanceKey: { not: "hub-host", startsWith: "server-5", mode: "insensitive" },
    }]) }],
  }) }));
});
