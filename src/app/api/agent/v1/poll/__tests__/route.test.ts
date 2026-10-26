/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The host-agent poll endpoint sits behind a public proxy prefix (`/api/agent/`)
 * and verifies its own Bearer token, so its guards are the only thing between an
 * anonymous caller and the agent job queue.
 */

const mocks = vi.hoisted(() => ({
  withRateLimit: vi.fn(),
  authenticateServerAgent: vi.fn(),
  claimNextServerAgentJob: vi.fn(),
  completeServerAgentJob: vi.fn(),
  heartbeatServerAgentJob: vi.fn(),
  updateServerAgentHeartbeat: vi.fn(),
  agentSelfUpdateFor: vi.fn(),
}));

vi.mock("@/lib/http/rate-limit-presets", () => ({
  withRateLimit: mocks.withRateLimit,
  AGENT_POLL_LIMIT: { maxRequests: 240, windowMs: 60_000 },
}));
vi.mock("@/lib/server/agent-service", () => ({
  authenticateServerAgent: mocks.authenticateServerAgent,
  claimNextServerAgentJob: mocks.claimNextServerAgentJob,
  completeServerAgentJob: mocks.completeServerAgentJob,
  heartbeatServerAgentJob: mocks.heartbeatServerAgentJob,
  updateServerAgentHeartbeat: mocks.updateServerAgentHeartbeat,
  agentSelfUpdateFor: mocks.agentSelfUpdateFor,
}));

const { POST } = await import("../route");

function poll(body: unknown, token = "vca_srv1_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa") {
  return new Request("https://hub.example/api/agent/v1/poll", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
}

describe("POST /api/agent/v1/poll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.withRateLimit.mockResolvedValue({ allowed: true, retryAfterMs: 0, remaining: 239 });
    mocks.authenticateServerAgent.mockResolvedValue({ id: "srv1" });
    mocks.updateServerAgentHeartbeat.mockResolvedValue(undefined);
    mocks.claimNextServerAgentJob.mockResolvedValue(null);
    mocks.completeServerAgentJob.mockResolvedValue(undefined);
    mocks.heartbeatServerAgentJob.mockResolvedValue(false);
    mocks.agentSelfUpdateFor.mockReturnValue(null);
  });

  it("rate-limits before the token lookup, so an anonymous flood costs no query", async () => {
    mocks.withRateLimit.mockResolvedValue({ allowed: false, retryAfterMs: 3_400, remaining: 0 });

    const response = await POST(poll({ version: "1.0.0" }));

    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("4");
    expect(mocks.authenticateServerAgent).not.toHaveBeenCalled();
  });

  it("rejects an unknown token with 401 and touches no job state", async () => {
    mocks.authenticateServerAgent.mockResolvedValue(null);

    const response = await POST(poll({ version: "1.0.0" }));

    expect(response.status).toBe(401);
    expect(mocks.updateServerAgentHeartbeat).not.toHaveBeenCalled();
    expect(mocks.claimNextServerAgentJob).not.toHaveBeenCalled();
  });

  it("rejects a malformed payload with 400", async () => {
    const response = await POST(poll({ result: { jobId: "j1", exitCode: 999 } }));

    expect(response.status).toBe(400);
    expect(mocks.completeServerAgentJob).not.toHaveBeenCalled();
  });

  it("scopes a submitted result to the authenticated server, not a client-supplied id", async () => {
    await POST(poll({ result: { jobId: "job-1", stdout: "ok", exitCode: 0 } }));

    // The body carries no serverId on purpose: it comes from the token, so one
    // agent cannot complete another server's job.
    expect(mocks.completeServerAgentJob).toHaveBeenCalledWith(
      expect.objectContaining({ serverId: "srv1", jobId: "job-1", exitCode: 0 }),
    );
  });

  it("answers a heartbeat with the cancellation flag and claims no new job", async () => {
    mocks.heartbeatServerAgentJob.mockResolvedValue(true);

    const response = await POST(poll({ heartbeatJobId: "job-1" }));
    const json = await response.json();

    expect(json).toMatchObject({ cancelled: true, job: null });
    // A long-running command must not be handed a second job mid-flight.
    expect(mocks.claimNextServerAgentJob).not.toHaveBeenCalled();
  });

  it("returns the next job with an immediate re-poll hint", async () => {
    mocks.claimNextServerAgentJob.mockResolvedValue({
      id: "job-2",
      command: "uptime",
      timeoutMs: 30_000,
      serverId: "srv1",
    });

    const response = await POST(poll({ version: "1.0.0" }));
    const json = await response.json();

    expect(json.pollAfterMs).toBe(0);
    // Only the protocol fields are exposed — no internal columns leak.
    expect(Object.keys(json.job).sort()).toEqual(["command", "id", "timeoutMs"]);
  });

  it("offers the hub's Agent build on an idle poll only", async () => {
    mocks.agentSelfUpdateFor.mockReturnValue({ version: "9.9.9", script: "c2NyaXB0" });
    const request = poll({ version: "1.5.0", capabilities: ["metrics", "command", "self-update"] });
    request.headers.set("host", "hub.example");

    const json = await (await POST(request)).json();

    expect(json).toMatchObject({ pollAfterMs: 0, job: null, update: { version: "9.9.9", script: "c2NyaXB0" } });
    expect(mocks.agentSelfUpdateFor).toHaveBeenCalledWith(expect.objectContaining({ version: "1.5.0", requestHost: "hub.example" }));
  });

  it("never holds queued work back for an update", async () => {
    mocks.agentSelfUpdateFor.mockReturnValue({ version: "9.9.9", script: "c2NyaXB0" });
    mocks.claimNextServerAgentJob.mockResolvedValue({ id: "job-3", command: "uptime", timeoutMs: 30_000, serverId: "srv1" });

    const json = await (await POST(poll({ version: "1.5.0", capabilities: ["self-update"] }))).json();

    expect(json.job).toMatchObject({ id: "job-3" });
    expect(json.update).toBeUndefined();
  });

  it("takes the result of an Agent that is stopping but hands it no new job", async () => {
    // A job claimed now would never run: the Agent exits after this request.
    const json = await (await POST(poll({ stopping: true, result: { jobId: "job-4", exitCode: 143 } }))).json();

    expect(mocks.completeServerAgentJob).toHaveBeenCalledWith(expect.objectContaining({ jobId: "job-4", exitCode: 143 }));
    expect(mocks.claimNextServerAgentJob).not.toHaveBeenCalled();
    expect(json).toMatchObject({ job: null });
    expect(json.update).toBeUndefined();
  });

  it("idles at 5s when the queue is empty", async () => {
    const response = await POST(poll({ version: "1.0.0" }));
    const json = await response.json();

    expect(json).toMatchObject({ pollAfterMs: 5_000, job: null });
  });
});
