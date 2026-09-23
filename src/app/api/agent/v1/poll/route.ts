import { NextResponse } from "next/server";
import { z } from "zod";

import { AGENT_POLL_LIMIT, withRateLimit } from "@/lib/http/rate-limit-presets";
import { readRequestBodyBuffer } from "@/lib/http/request-body";
import {
  authenticateServerAgent,
  claimNextServerAgentJob,
  completeServerAgentJob,
  heartbeatServerAgentJob,
  updateServerAgentHeartbeat,
} from "@/lib/server/agent-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  version: z.string().max(64).optional(),
  capabilities: z.array(z.string().max(64)).max(20).optional(),
  metricsRaw: z.string().max(64_000).optional(),
  error: z.string().max(1000).nullable().optional(),
  heartbeatJobId: z.string().min(1).max(128).optional(),
  result: z.object({
    jobId: z.string().min(1).max(128),
    stdout: z.string().max(8 * 1_048_576).optional(),
    stderr: z.string().max(1_048_576).optional(),
    exitCode: z.number().int().min(-1).max(255),
  }).optional(),
});

/** Schema ceilings (8 MiB stdout + 1 MiB stderr) plus JSON framing headroom. */
const MAX_AGENT_POLL_BODY_BYTES = 10 * 1_048_576;

export async function POST(request: Request) {
  // `/api/agent/` is a public prefix in the proxy (the Bearer token is verified
  // here instead), and the token regex is trivially matchable, so an anonymous
  // caller could force one `server.findUnique` per request before auth rejects
  // it. Limit by IP first, ahead of that lookup. The budget is well above a real
  // agent's cadence — see AGENT_POLL_LIMIT.
  const rateLimit = await withRateLimit(request, AGENT_POLL_LIMIT);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Rate limit exceeded" }, // api-copy-audit: allow -- stable machine protocol
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil(rateLimit.retryAfterMs / 1000)) },
      },
    );
  }
  const authorization = request.headers.get("authorization") ?? "";
  const agent = await authenticateServerAgent(authorization.replace(/^Bearer\s+/i, ""));
  if (!agent) return NextResponse.json({ error: "Unauthorized agent" }, { status: 401 }); // api-copy-audit: allow -- stable machine protocol
  // Bounded read instead of request.json(): the schema allows ~9 MiB of
  // stdout/stderr, but a chunked body with no Content-Length must not turn
  // the public prefix into an unbounded memory sink.
  let rawPayload: unknown;
  try {
    rawPayload = JSON.parse(
      (await readRequestBodyBuffer(request, MAX_AGENT_POLL_BODY_BYTES)).toString("utf8"),
    );
  } catch {
    rawPayload = null;
  }
  const parsed = bodySchema.safeParse(rawPayload);
  if (!parsed.success) return NextResponse.json({ error: "Invalid agent payload" }, { status: 400 }); // api-copy-audit: allow -- stable machine protocol
  if (parsed.data.result) {
    await completeServerAgentJob({ serverId: agent.id, ...parsed.data.result });
  }
  await updateServerAgentHeartbeat({ serverId: agent.id, ...parsed.data });
  if (parsed.data.heartbeatJobId) {
    const cancelled = await heartbeatServerAgentJob({
      serverId: agent.id,
      jobId: parsed.data.heartbeatJobId,
    });
    return NextResponse.json({ pollAfterMs: 5_000, cancelled, job: null });
  }
  const job = await claimNextServerAgentJob(agent.id);
  return NextResponse.json({
    pollAfterMs: job ? 0 : 5_000,
    job: job ? { id: job.id, command: job.command, timeoutMs: job.timeoutMs } : null,
  });
}
