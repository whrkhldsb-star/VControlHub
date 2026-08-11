import { NextResponse } from "next/server";
import { z } from "zod";

import {
  authenticateServerAgent,
  claimNextServerAgentJob,
  completeServerAgentJob,
  updateServerAgentHeartbeat,
} from "@/lib/server/agent-service";

export const dynamic = "force-dynamic";

const bodySchema = z.object({
  version: z.string().max(64).optional(),
  capabilities: z.array(z.string().max(64)).max(20).optional(),
  metricsRaw: z.string().max(64_000).optional(),
  error: z.string().max(1000).nullable().optional(),
  result: z.object({
    jobId: z.string().min(1).max(128),
    stdout: z.string().max(8 * 1_048_576).optional(),
    stderr: z.string().max(1_048_576).optional(),
    exitCode: z.number().int().min(-1).max(255),
  }).optional(),
});

export async function POST(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  const agent = await authenticateServerAgent(authorization.replace(/^Bearer\s+/i, ""));
  if (!agent) return NextResponse.json({ error: "Unauthorized agent" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid agent payload" }, { status: 400 });
  if (parsed.data.result) {
    await completeServerAgentJob({ serverId: agent.id, ...parsed.data.result });
  }
  await updateServerAgentHeartbeat({ serverId: agent.id, ...parsed.data });
  const job = await claimNextServerAgentJob(agent.id);
  return NextResponse.json({
    pollAfterMs: job ? 0 : 5_000,
    job: job ? { id: job.id, command: job.command, timeoutMs: job.timeoutMs } : null,
  });
}
