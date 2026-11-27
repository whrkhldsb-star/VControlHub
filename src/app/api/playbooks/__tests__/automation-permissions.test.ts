import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  loadOwner: vi.fn(),
  requirePermission: vi.fn(),
  findRule: vi.fn(),
  createRule: vi.fn(),
  findBoundPlaybooks: vi.fn(),
  updateRule: vi.fn(),
  findPlaybook: vi.fn(),
  updatePlaybook: vi.fn(),
  audit: vi.fn(),
}));
vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: mocks.verifyToken }));
vi.mock("@/lib/api-token/authorization", async (original) => ({
  ...await original<typeof import("@/lib/api-token/authorization")>(),
  loadApiTokenOwnerSession: mocks.loadOwner,
}));
vi.mock("@/lib/auth/require-api-permission", () => ({ requireApiPermission: mocks.requirePermission }));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ lockForTransaction: vi.fn(), acquireAdvisoryLock: async () => async () => {} }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: {
  $queryRaw: async () => [{ id: "rule1" }],
  $transaction<T>(run: (tx: unknown) => T) { return run(this); },
  alertRule: { count: async () => 0, create: mocks.createRule, findFirst: mocks.findRule, updateManyAndReturn: mocks.updateRule },
  playbook: { findMany: mocks.findBoundPlaybooks, findFirst: mocks.findPlaybook, updateMany: mocks.updatePlaybook },
  userServerAccess: { findFirst: async () => null },
  server: { findMany: async () => [{ id: "srv1" }] },
} }));

import { PATCH as patchRule, POST as createRule } from "@/app/api/alert-rules/route";
import { PATCH as patchPlaybook } from "@/app/api/playbooks/[id]/route";

function request(path: string, body: object, method = "PATCH", auth: "session" | "bearer" = "session") {
  return new Request(`http://local/api/${path}`, {
    method,
    headers: {
      ...(auth === "bearer" ? { authorization: "Bearer test-token" } : {}),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function sessionWith(...permissions: string[]) {
  mocks.requirePermission.mockResolvedValueOnce({
    session: { userId: "u1", roles: ["operator"], currentTeamId: "team1", permissions },
  });
}

describe("automation write permissions through PATCH and POST", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findBoundPlaybooks.mockResolvedValue([{ id: "pb1", steps: [] }]);
    mocks.loadOwner.mockResolvedValue({
      userId: "u1", roles: ["operator"], currentTeamId: "team1",
      permissions: ["notification:manage", "playbook:manage", "playbook:run", "command:execute"],
    });
  });

  it("refuses Bearer tokens on state-changing alert-rule and playbook routes before token lookup", async () => {
    const ctx = { params: Promise.resolve({ id: "pb1" }) };
    expect((await createRule(request("alert-rules", { name: "CPU" }, "POST", "bearer"))).status).toBe(403);
    expect((await patchRule(request("alert-rules", { id: "rule1", threshold: 60 }, "PATCH", "bearer"))).status).toBe(403);
    expect((await patchPlaybook(request("playbooks/pb1", { id: "pb1", steps: [] }, "PATCH", "bearer"), ctx)).status).toBe(403);
    expect(mocks.verifyToken).not.toHaveBeenCalled();
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.updateRule).not.toHaveBeenCalled();
    expect(mocks.updatePlaybook).not.toHaveBeenCalled();
  });

  it.each([
    { body: { id: "rule1", threshold: 60 }, enabled: true },
    { body: { toggleId: "rule1" }, enabled: false },
  ])("requires the caller's run grant to update or enable a bound rule ($body)", async ({ body, enabled }) => {
    const rule = { id: "rule1", playbookIds: ["pb1"], serverIds: [], teamId: "team1", notifyChannels: ["in_app"], updatedAt: new Date(), enabled, createdAt: new Date() };
    mocks.findRule.mockResolvedValue(rule);
    mocks.updateRule.mockResolvedValue([rule]);
    sessionWith("notification:manage");
    const refused = await patchRule(request("alert-rules", body));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.updateRule).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();

    sessionWith("notification:manage", "playbook:run");
    expect((await patchRule(request("alert-rules", body))).status).toBe(200);
    expect(mocks.updateRule).toHaveBeenCalledOnce();
  });

  it.each(["POST", "PATCH"])("passes only the caller's granted command and run scopes through alert %s", async (method) => {
    const rule = { id: "rule1", name: "CPU", metric: "cpu_usage", operator: "gte", threshold: 60,
      serverIds: [], playbookIds: ["pb1"], teamId: "team1", notifyChannels: ["in_app"], updatedAt: new Date(), enabled: true, createdAt: new Date(),
    };
    mocks.findRule.mockResolvedValue(rule);
    mocks.createRule.mockResolvedValue(rule);
    mocks.updateRule.mockResolvedValue([rule]);
    mocks.findBoundPlaybooks.mockResolvedValue([{ id: "pb1", steps: [{ type: "run_command", config: { serverIds: ["srv1"] } }] }]);
    const perform = () => method === "POST"
      ? createRule(request("alert-rules", rule, method))
      : patchRule(request("alert-rules", { id: rule.id, threshold: 85 }));
    for (const grant of ["playbook:run", "command:execute"]) {
      sessionWith("notification:manage", grant);
      expect((await perform()).status).toBe(403);
    }
    expect(mocks.createRule).not.toHaveBeenCalled();
    expect(mocks.updateRule).not.toHaveBeenCalled();
    sessionWith("notification:manage", "playbook:run", "command:execute");
    expect((await perform()).status).toBe(method === "POST" ? 201 : 200);
  });

  it("passes the caller's run and command grants through a steps-only playbook patch", async () => {
    const step = { id: "s1", name: "Read uptime", type: "run_command", config: { serverIds: ["srv1"], command: "uptime" } };
    const payload = { id: "pb1", steps: [step] };
    const ctx = { params: Promise.resolve({ id: "pb1" }) };
    mocks.findPlaybook.mockResolvedValue({ id: "pb1", triggerType: "cron", enabled: true, steps: [] });
    mocks.updatePlaybook.mockResolvedValue({ count: 1 });
    for (const grant of ["command:execute", "playbook:run"]) {
      sessionWith("playbook:manage", grant);
      const refused = await patchPlaybook(request("playbooks/pb1", payload), ctx);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.updatePlaybook).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    sessionWith("playbook:manage", "playbook:run", "command:execute");
    expect((await patchPlaybook(request("playbooks/pb1", payload), ctx)).status).toBe(200);
    expect(mocks.updatePlaybook).toHaveBeenCalledOnce();
  });
});
