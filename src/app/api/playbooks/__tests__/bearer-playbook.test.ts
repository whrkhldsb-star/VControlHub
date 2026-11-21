import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  verifyToken: vi.fn(), loadOwner: vi.fn(), findPlaybook: vi.fn(), listPlaybooks: vi.fn(),
  createPlaybook: vi.fn(), servers: vi.fn(), runCreate: vi.fn(), runUpdate: vi.fn(), jobCreate: vi.fn(),
}));
vi.mock("@/lib/api-token/service", () => ({ verifyApiToken: mocks.verifyToken }));
vi.mock("@/lib/api-token/authorization", async (original) => ({
  ...await original<typeof import("@/lib/api-token/authorization")>(), loadApiTokenOwnerSession: mocks.loadOwner,
}));
vi.mock("@/lib/concurrency/advisory-lock", () => ({ acquireAdvisoryLock: async () => async () => {} }));
vi.mock("@/lib/audit/service", () => ({ auditUserAction: vi.fn() }));
vi.mock("@/lib/db", () => ({ prisma: {
  playbook: { findFirst: mocks.findPlaybook, findMany: mocks.listPlaybooks, create: mocks.createPlaybook },
  server: { findMany: mocks.servers },
  $transaction: async (apply: (tx: unknown) => unknown) => apply({
    playbookRun: { create: mocks.runCreate, update: mocks.runUpdate },
    job: { create: mocks.jobCreate }, jobEvent: { create: vi.fn() },
  }),
} }));

import { GET as list, POST as create } from "../route";
import { GET as get } from "../[id]/route";
import { POST as run } from "../[id]/run/route";
import { POST as dryRun } from "../[id]/dry-run/route";

const ctx = { params: Promise.resolve({ id: "p1" }) };
const command = { id: "cmd", name: "Check uptime", type: "run_command", config: { serverIds: ["srv1"], command: "uptime" } };
const hook = { id: "hook", name: "Alert", type: "call_webhook", config: {
  url: "https://example.org/token-path?key=token-query", method: "POST", headers: { authorization: "token-header" }, body: "token-body",
} };
const playbook = { id: "p1", name: "Cleanup", teamId: "team1", triggerType: "cron",
  triggerConfig: { expression: "* * * * *" }, steps: [command], enabled: true, chainRetry: 0 };
function request(method: string, body?: object) {
  return new Request("http://local/api/playbooks", {
    method, headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: body && JSON.stringify(body),
  });
}
function token(...scopes: string[]) { mocks.verifyToken.mockResolvedValue({ userId: "u1", scopes }); }

describe("effective Bearer permissions for playbook definitions and runs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.loadOwner.mockResolvedValue({
      userId: "u1", roles: ["operator"], currentTeamId: "team1",
      permissions: ["playbook:read", "playbook:manage", "playbook:run", "command:execute"],
    });
    mocks.createPlaybook.mockResolvedValue(playbook);
    mocks.findPlaybook.mockResolvedValue(playbook);
    mocks.servers.mockResolvedValue([{ id: "srv1" }]);
    mocks.runCreate.mockResolvedValue({ id: "run" });
    mocks.runUpdate.mockResolvedValue({ id: "run", stepResults: [] });
    mocks.jobCreate.mockResolvedValue({ id: "job" });
  });

  it("requires the run grant to create enabled automation and the execute grant for command steps", async () => {
    for (const extra of ["playbook:run", "command:execute"]) {
      token("playbook:manage", extra);
      expect((await create(request("POST", playbook))).status).toBe(403);
    }
    expect(mocks.createPlaybook).not.toHaveBeenCalled();
    token("playbook:manage", "command:execute");
    expect((await create(request("POST", { ...playbook, enabled: false }))).status).toBe(200);
    token("playbook:manage", "playbook:run", "command:execute");
    expect((await create(request("POST", playbook))).status).toBe(200);
  });

  it("requires execute and connect on all targets before enqueueing a real command run", async () => {
    token("playbook:run");
    expect((await run(request("POST"), ctx)).status).toBe(403);
    token("playbook:run", "command:execute");
    mocks.servers.mockResolvedValueOnce([]);
    expect((await run(request("POST"), ctx)).status).toBe(400);
    expect(mocks.servers).toHaveBeenCalledWith({
      where: { id: { in: ["srv1"] }, AND: [{ teamId: "team1" }, { team: { deletedAt: null }, OR: [
        { userAccess: { none: { userId: "u1" } } }, { userAccess: { some: { userId: "u1", canConnect: true } } },
      ] }] }, select: { id: true },
    });
    expect(mocks.jobCreate).not.toHaveBeenCalled();
    expect((await run(request("POST"), ctx)).status).toBe(202);
    token("playbook:run");
    expect((await dryRun(request("POST"), ctx)).status).toBe(202);
  });

  it("projects webhook configs on list and detail according to the token's own manage grant", async () => {
    const definition = { ...playbook, steps: [{ ...hook, name: hook.config.url, oldUrl: hook.config.url }] };
    mocks.findPlaybook.mockResolvedValue(definition);
    mocks.listPlaybooks.mockResolvedValue([definition]);
    for (const manage of [false, true]) {
      token("playbook:read", ...(manage ? ["playbook:manage"] : []));
      const listBody = await (await list(request("GET"))).json();
      const detailBody = await (await get(request("GET"), ctx)).json();
      for (const row of [listBody.playbooks[0], detailBody.playbook]) {
        expect(row.steps[0].config).toEqual(manage ? hook.config : {
          method: "POST", host: "example.org", hasHeaders: true, hasBody: true, urlConfigured: true,
        });
        if (!manage) expect(JSON.stringify(row)).not.toMatch(/token-(path|query|header|body)/);
      }
    }
  });
});
