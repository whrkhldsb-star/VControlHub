import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { withRateLimit, FILE_AGENT_POLL_LIMIT } from "@/lib/http/rate-limit-presets";
import { readRequestBodyBuffer } from "@/lib/http/request-body";
import { parseFileCredential, pollFileAgent } from "@/lib/storage/agent-file-queue";

export const dynamic = "force-dynamic";
const entry = z.object({
  name: z.string().max(255),
  isDirectory: z.boolean(),
  size: z.number().int().nonnegative(),
  lastModifiedMs: z.number().int(),
  etag: z.string().max(100),
});
const result = z
  .object({
    error: z.enum(["missing", "exists", "denied", "changed", "invalid", "io"]).optional(),
    entry: entry.optional(),
    entries: z.array(entry).max(8192).optional(),
    offset: z.number().int().nonnegative(),
    data: z.string().max(1_398_104).optional(),
    digest: z
      .string()
      .regex(/^[a-f0-9]{64}$/)
      .optional(),
  })
  .strict();
const poll = z.object({
  rootIdentity: z.string().regex(/^[a-f0-9]{64}$/),
  writable: z.boolean(),
  receipt: z.object({ id: z.string().max(64), result }).optional(),
});

// guardMode: bearer
export async function POST(request: Request) {
  const rate = await withRateLimit(request, FILE_AGENT_POLL_LIMIT);
  if (!rate.allowed) return new Response(null, { status: 429 });
  const hash = parseFileCredential(request.headers.get("authorization"));
  if (!hash) return new Response(null, { status: 401 });
  // Authenticate before buffering a file chunk. The transaction checks the identity again at claim time.
  if (!(await prisma.agentFileShare.findFirst({ where: { tokenHash: hash }, select: { id: true } })))
    return new Response(null, { status: 401 });
  let body;
  try {
    body = poll.parse(JSON.parse((await readRequestBodyBuffer(request, 2 * 1024 * 1024)).toString("utf8")));
  } catch {
    return new Response(null, { status: 400 });
  }
  const reply = await pollFileAgent(hash, body.rootIdentity, body.writable, body.receipt);
  return reply
    ? NextResponse.json(reply, { headers: { "Cache-Control": "no-store" } })
    : new Response(null, { status: 401 });
}
