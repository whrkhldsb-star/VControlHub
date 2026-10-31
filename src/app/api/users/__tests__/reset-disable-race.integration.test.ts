// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
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
const { PATCH } = await import("../route");
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("reset/disable real database race", () => {
const id = `reset-disable-${randomUUID()}`;
beforeAll(async () => {
 const db = new URL(process.env.DATABASE_URL!);
 if (!["127.0.0.1", "localhost", "[::1]"].includes(db.hostname) || !/audit|test|_ci/.test(db.pathname)) throw new Error("Disposable database required");
 await prisma.user.create({ data: { id, username: id, passwordHash: "old-hash", status: "ACTIVE", mustChangePassword: false } });
});
afterAll(async () => { await prisma.user.deleteMany({ where: { id } }); await prisma.$disconnect(); });
it("keeps an account disabled when reset hashing finishes after disable", async () => {
  let hashing!: () => void;
  let release!: (hash: string) => void;
  const entered = new Promise<void>((r) => { hashing = r; });
  s.hash.mockImplementation(() => { hashing(); return new Promise<string>((r) => { release = r; }); });
  const request = (action: string) => new Request("http://local/api/users", { method: "PATCH", body: JSON.stringify({ userId: id, action, newPassword: "test-only" }) });
  const reset = PATCH(request("reset_password"));
  await entered;
  expect((await PATCH(request("disable"))).status).toBe(200);
  expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe("DISABLED");
  release("new-test-hash");
  expect((await reset).status).toBe(200);
  expect((await prisma.user.findUniqueOrThrow({ where: { id } })).status).toBe("DISABLED");
});

});
