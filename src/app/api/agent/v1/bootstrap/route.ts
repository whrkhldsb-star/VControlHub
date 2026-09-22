import { NextResponse } from "next/server";

import { config } from "@/lib/config/env";
import { AGENT_POLL_LIMIT, withRateLimit } from "@/lib/http/rate-limit-presets";
import { authenticateServerAgent, buildWindowsAgentInstaller } from "@/lib/server/agent-service";

export const dynamic = "force-dynamic";

/**
 * GET /api/agent/v1/bootstrap — authenticated installer download for the
 * Windows agent. The Bearer token doubles as the install credential (the same
 * secret the installed agent keeps polling with), so no session is involved.
 * The operator pastes the one-liner produced by prepareWindowsAgentInstall
 * into an elevated PowerShell on the Windows machine, which fetches this
 * script. APP_BASE_URL (not the request Host header) defines the poll
 * endpoint embedded in the agent so reverse-proxy schemes cannot downgrade it.
 */
export async function GET(request: Request) {
  // Same pre-auth rate limiting rationale as the poll endpoint: this is a
  // public prefix and each request performs a server lookup before the token
  // is verified.
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
  const token = (request.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  const agent = await authenticateServerAgent(token);
  if (!agent) return NextResponse.json({ error: "Unauthorized agent" }, { status: 401 }); // api-copy-audit: allow -- stable machine protocol
  if (agent.operatingSystem !== "WINDOWS") {
    return NextResponse.json({ error: "Bootstrap is only available for Windows agents" }, { status: 404 }); // api-copy-audit: allow -- stable machine protocol
  }
  const hubUrl = config.app.baseUrl;
  if (!hubUrl) return NextResponse.json({ error: "Agent hub URL is not configured" }, { status: 503 }); // api-copy-audit: allow -- stable machine protocol
  const installer = buildWindowsAgentInstaller(hubUrl, token);
  return new NextResponse(installer, {
    status: 200,
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
