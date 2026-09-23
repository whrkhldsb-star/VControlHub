import { rdpCertificateOptions } from "./certificate";
import { createHash, randomBytes } from "node:crypto";
import { createConnection } from "node:net";
import type { Server } from "@prisma/client";
import { prisma } from "@/lib/db";
import { serverTeamWhere, type TeamSession } from "@/lib/auth/team-scope";
import { BusinessError, ForbiddenError, NotFoundError } from "@/lib/errors";
import { config } from "@/lib/config/env";
import { isValidTcpPort } from "@/lib/runtime/listen-port";
import { assertPublicRdpHost } from "./protocol";
import { t } from "@/lib/i18n/service-translations";

export const hashRdpValue = (value: string) => createHash("sha256").update(value).digest("hex");
export const rdpEndpointHash = (server: Server) => hashRdpValue(JSON.stringify([server.host, server.port, server.username, server.rdpPassword, server.rdpDomain, server.rdpIgnoreCertificate, server.rdpCertificateSha256, server.teamId, server.updatedAt]));
// Compare origins case-insensitively through the same centralized config the
// SSH terminal uses (config.ssh.wsAllowedOrigins). A literal env re-read with
// a case-sensitive compare here drifted from ssh-ws-proxy's lowercased match:
// "https://Example.com" was accepted by one and rejected by the other.
export function rdpOriginAllowed(origin: string) {
	const normalized = origin.trim().toLowerCase();
	return Boolean(
		normalized &&
			config.ssh.wsAllowedOrigins.some((allowed) => allowed.trim().toLowerCase() === normalized),
	);
}
export async function getRdpServer(serverId: string, session: TeamSession) {
 const server = await prisma.server.findFirst({ where: { AND: [{ id: serverId }, serverTeamWhere(session)] } });
 if (!server) throw new NotFoundError();
 if (server.operatingSystem !== "WINDOWS" || !server.enabled || !server.rdpPassword) throw new BusinessError(t("backend.rdp.notEnabled"));
 rdpCertificateOptions(server);
 assertPublicRdpHost(server.host);
 return server;
}
export function guacdPort() {
 const port = Number(process.env.GUACD_PORT ?? 4822);
 if (!isValidTcpPort(port)) throw new BusinessError(t("backend.rdp.unavailable"), undefined, 503);
 return port;
}
/** Only checks daemon availability, NEVER claims successful Windows authentication. */
export async function checkGuacd() {
 if (process.env.RDP_ENABLED !== "true") throw new BusinessError(t("backend.rdp.unavailable"), undefined, 503);
 await new Promise<void>((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port: guacdPort() });
  const fail = () => { socket.destroy(); reject(new BusinessError(t("backend.rdp.unavailable"), undefined, 503)); };
  socket.setTimeout(2000, fail);
  socket.once("error", fail);
  socket.once("connect", () => { socket.destroy(); resolve(); });
 });
}
export async function mintRdpTicket(serverId: string, session: TeamSession, cookie: string, origin: string) {
 if (!rdpOriginAllowed(origin) || !cookie) throw new ForbiddenError();
 const server = await getRdpServer(serverId, session);
 await checkGuacd();
 const token = randomBytes(32).toString("base64url");
 await prisma.rdpTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
 await prisma.rdpTicket.create({ data: { hash: hashRdpValue(token), serverId, userId: session.userId, teamId: session.currentTeamId ?? null,
  sessionHash: hashRdpValue(cookie), origin, endpointHash: rdpEndpointHash(server), expiresAt: new Date(Date.now() + 30_000) } });
 return token;
}
/** Atomic delete is the single-use claim, including across proxy processes. */
export async function consumeRdpTicket(token: string, session: TeamSession, cookie: string, origin: string) {
 if (!/^[A-Za-z0-9_-]{43}$/.test(token) || !rdpOriginAllowed(origin)) throw new ForbiddenError();
 const ticket = await prisma.rdpTicket.findUnique({ where: { hash: hashRdpValue(token) } });
 if (!ticket || ticket.userId !== session.userId || ticket.teamId !== (session.currentTeamId ?? null) || ticket.sessionHash !== hashRdpValue(cookie) || ticket.origin !== origin || ticket.expiresAt.getTime() <= Date.now()) throw new ForbiddenError();
 const server = await getRdpServer(ticket.serverId, session);
 if (ticket.endpointHash !== rdpEndpointHash(server)) throw new ForbiddenError();
 const claimed = await prisma.rdpTicket.deleteMany({ where: { hash: ticket.hash, expiresAt: { gt: new Date() } } });
 if (claimed.count !== 1) throw new ForbiddenError();
 return server;
}
