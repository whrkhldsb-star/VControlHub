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

  it("idles at 5s when the queue is empty", async () => {
    const response = await POST(poll({ version: "1.0.0" }));
    const json = await response.json();

    expect(json).toMatchObject({ pollAfterMs: 5_000, job: null });
  });
});
