import { expect, it, vi } from "vitest";
const s = vi.hoisted(() => ({
  row: { id: "target", username: "target", status: "ACTIVE", sessionEpoch: 1, teamMembership: null } as Record<string, unknown>,
  hash: vi.fn(),
}));
vi.mock("@/lib/auth/password", () => ({ hashPassword: s.hash }));
vi.mock("@/lib/auth/password-policy", () => ({ validatePasswordPolicy: async () => null }));
vi.mock("@/lib/auth/team-scope", () => ({ assertUserInActorScope: async () => {}, userDirectoryWhere: () => ({}) }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: async () => {} }));
vi.mock("@/lib/user/admin-invariant", () => ({ assertAdminAccessMayBeRemoved: async () => {}, withAdminInvariantLock: async (f: () => Promise<unknown>) => f() }));
vi.mock("@/lib/http/api-guard", () => ({ withApiRoute: async (r: Request, _o: unknown, f: (ctx: unknown) => Promise<Response>) => f({ session: { userId: "admin", roles: ["admin"] }, body: await r.json() }) }));
vi.mock("@/lib/db", () => ({ prisma: { user: {
  findUnique: async () => ({ ...s.row }),
  update: async ({ data }: { data: Record<string, unknown> }) => { Object.assign(s.row, data); return { ...s.row }; },
} } }));
const { PATCH } = await import("../route");
it("keeps an account disabled when reset hashing finishes after disable", async () => {
  let hashing!: () => void;
  let release!: (hash: string) => void;
  const entered = new Promise<void>((r) => { hashing = r; });
  s.hash.mockImplementation(() => { hashing(); return new Promise<string>((r) => { release = r; }); });
  const request = (action: string) => new Request("http://local/api/users", { method: "PATCH", body: JSON.stringify({ userId: "target", action, newPassword: "test-only" }) });
  const reset = PATCH(request("reset_password"));
  await entered;
  expect((await PATCH(request("disable"))).status).toBe(200);
  expect(s.row.status).toBe("DISABLED");
  release("new-test-hash");
  expect((await reset).status).toBe(200);
  expect(s.row.status).toBe("DISABLED");
});
