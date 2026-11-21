import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(),
  loadOwner: vi.fn(),
  findRule: vi.fn(),
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
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: async () => async () => {} }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: mocks.audit }));
vi.mock("@/lib/db", () => ({ prisma: {
  alertRule: { findFirst: mocks.findRule, updateManyAndReturn: mocks.updateRule },
  playbook: { findFirst: mocks.findPlaybook, updateMany: mocks.updatePlaybook },
  server: { findMany: async () => [{ id: "srv1" }] },
} }));

import { PATCH as patchRule } from "@/app/api/alert-rules/route";
import { PATCH as patchPlaybook } from "@/app/api/playbooks/[id]/route";

function request(path: string, body: object) {
  return new Request(`http://local/api/${path}`, {
    method: "PATCH",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("automation write permissions through PATCH", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadOwner.mockResolvedValue({
      userId: "u1", roles: ["operator"], currentTeamId: "team1",
      permissions: ["notification:manage", "playbook:manage", "playbook:run", "command:execute"],
    });
  });

  it.each([
    { body: { id: "rule1", threshold: 60 }, enabled: true },
    { body: { toggleId: "rule1" }, enabled: false },
  ])("requires the token's run grant to update or enable a bound rule ($body)", async ({ body, enabled }) => {
    const rule = { id: "rule1", playbookIds: ["pb1"], enabled, createdAt: new Date() };
    mocks.findRule.mockResolvedValue(rule);
    mocks.updateRule.mockResolvedValue([rule]);
    mocks.verifyToken.mockResolvedValueOnce({ userId: "u1", scopes: ["notification:manage"] });
    const refused = await patchRule(request("alert-rules", body));
    expect(refused.status).toBe(403);
    expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
    expect(mocks.updateRule).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();

    mocks.verifyToken.mockResolvedValueOnce({ userId: "u1", scopes: ["notification:manage", "playbook:run"] });
    expect((await patchRule(request("alert-rules", body))).status).toBe(200);
    expect(mocks.updateRule).toHaveBeenCalledOnce();
  });

  it("passes the token's run and command grants through a steps-only playbook patch", async () => {
    const step = { id: "s1", name: "Read uptime", type: "run_command", config: { serverIds: ["srv1"], command: "uptime" } };
    const payload = { id: "pb1", steps: [step] };
    const ctx = { params: Promise.resolve({ id: "pb1" }) };
    mocks.findPlaybook.mockResolvedValue({ id: "pb1", triggerType: "cron", enabled: true, steps: [] });
    mocks.updatePlaybook.mockResolvedValue({ count: 1 });
    for (const grant of ["command:execute", "playbook:run"]) {
      mocks.verifyToken.mockResolvedValueOnce({ userId: "u1", scopes: ["playbook:manage", grant] });
      const refused = await patchPlaybook(request("playbooks/pb1", payload), ctx);
      expect(refused.status).toBe(403);
      expect(await refused.json()).toMatchObject({ code: "FORBIDDEN" });
    }
    expect(mocks.updatePlaybook).not.toHaveBeenCalled();
    expect(mocks.audit).not.toHaveBeenCalled();
    mocks.verifyToken.mockResolvedValueOnce({ userId: "u1", scopes: ["playbook:manage", "playbook:run", "command:execute"] });
    expect((await patchPlaybook(request("playbooks/pb1", payload), ctx)).status).toBe(200);
    expect(mocks.updatePlaybook).toHaveBeenCalledOnce();
  });
});
