import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSessionCookieName, verifySessionToken } from "@/lib/auth/session";
import { withApiRoute } from "@/lib/http/api-guard";
import { GENERAL_WRITE_LIMIT } from "@/lib/http/rate-limit-presets";
import { AuthError, ForbiddenError } from "@/lib/errors";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { mintRdpTicket, rdpOriginAllowed } from "@/lib/rdp/tickets";
import { auditUserAction } from "@/lib/audit/service";

/** Cookie-authenticated only. Send the ticket as the first /rdp WS frame, never a URL. */
export async function POST(request: NextRequest) {
 return withApiRoute(request, {
  permission: "server:ssh", rateLimit: GENERAL_WRITE_LIMIT,
  bodySchema: z.object({ serverId: z.string().min(1).max(128) }).strict(),
 }, async ({session, body}) => {
  if (!session) throw new AuthError();
  const origin = request.headers.get("origin") ?? "";
  // TLS may terminate at the trusted reverse proxy; request.url can be internal HTTP.
  // Trust only explicitly configured public origins, never arbitrary forwarded headers.
  if (!rdpOriginAllowed(origin)) throw new ForbiddenError();
  const cookie = request.cookies.get(getSessionCookieName())?.value;
  if (!cookie) throw new AuthError();
  // API bearer authentication must never substitute for this cookie session.
  if (request.headers.has("authorization")) throw new ForbiddenError();
  const cookieSession = await verifySessionToken(cookie);
  if (cookieSession.mustChangePassword || !sessionHasPermission(cookieSession, "server:ssh") || cookieSession.userId !== session.userId || cookieSession.currentTeamId !== session.currentTeamId) throw new ForbiddenError();
  const token = await mintRdpTicket(body.serverId, cookieSession, cookie, origin);
  await auditUserAction(session.userId, "server.rdp.ticket", { serverId: body.serverId }, undefined, session.currentTeamId ?? null);
  return NextResponse.json({token, expiresIn: 30, path: "/rdp", protocol: "guacamole"}, {headers: {"Cache-Control":"no-store", "Pragma":"no-cache"}});
 });
}
