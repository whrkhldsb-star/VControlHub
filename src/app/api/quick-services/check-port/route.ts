import { quickServiceRemoteTarget } from "@/lib/quick-service/target-identity";
import { apiCopy } from "@/lib/i18n/api-copy";
import { z } from "zod";

import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { checkPort, allocatePort, getUsedPorts } from "@/lib/quick-service/service";
import { releasePortReservation } from "@/lib/quick-service/service-internals";
import { GENERAL_READ_LIMIT } from "@/lib/http/rate-limit-presets";
import { getRemoteUsedPorts, isRemotePortAvailable } from "@/lib/quick-service/docker-cli";
import { assertServerTeamAccess } from "@/lib/server/team-access";
import { assertHubHostDockerAccess } from "@/lib/docker/hub-host-access";

import { AppError, ValidationError } from "@/lib/errors";
import { getErrorMessage } from "@/lib/http/error-message";
export const dynamic = "force-dynamic";

const checkPortQuerySchema = z
	.object({
		port: z.coerce.number().int().min(1).max(65535).optional(),
		action: z.enum(["check", "allocate", "used-ports"]).optional(),
		preferred: z.coerce.number().int().min(1).max(65535).optional(),
		serverId: z.string().min(1).optional(),
	})
	.transform((value) => ({
		port: value.port,
		action: value.action ?? "check",
		preferred: value.preferred,
		serverId: value.serverId,
	}));

/** GET /api/quick-services/check-port?port=XXX — real-time port availability check */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "docker:manage", rateLimit: GENERAL_READ_LIMIT, errorStatus: 500, errorMessage: apiCopy("apiCopy.server.error.dfe0c2e8") }, async ({ session }) => {
		const { action, port, preferred, serverId } = parseSearchParams(request, checkPortQuerySchema);
		let remote: ReturnType<typeof quickServiceRemoteTarget> | undefined;
		if (serverId) {
			const access = await assertServerTeamAccess(session, serverId, "connect");
			if (!access.ok) return access.response;
			remote = quickServiceRemoteTarget(access.server);
		} else {
			// The hub host's used-port list is a port scan of the control plane.
			const hubAccess = assertHubHostDockerAccess(session);
			if (!hubAccess.ok) return hubAccess.response;
		}

		const instanceKey = serverId ?? "hub-host";
		const persistedRows = (await prisma.quickService?.findMany?.({
			where: { instanceKey },
			select: { slug: true, port: true, extraPortsJson: true },
		})) ?? [];
		const persistedPortOwner = new Map<number, string>();
		for (const row of persistedRows) {
			if (typeof row.port === "number" && row.port > 0) persistedPortOwner.set(row.port, row.slug);
			if (typeof row.extraPortsJson === "string" && row.extraPortsJson) {
				try {
					const parsed = JSON.parse(row.extraPortsJson);
					if (Array.isArray(parsed)) {
						for (const item of parsed) {
							const hp = Number((item as { host?: unknown })?.host);
							if (Number.isInteger(hp) && hp > 0) persistedPortOwner.set(hp, row.slug);
						}
					}
				} catch { /* ignore malformed historical JSON */ }
			}
		}

		// action=allocate: suggest a free port
		if (action === "allocate") {
			try {
				if (remote) {
					const start = preferred ?? 10_000;
					const usedPorts = new Set([...(await getRemoteUsedPorts(remote)), ...persistedPortOwner.keys()]);
					for (let offset = 0; offset < 2_000; offset += 1) {
						const candidate = ((start - 1 + offset) % 65_535) + 1;
						if (!usedPorts.has(candidate)) {
							return NextResponse.json({ port: candidate, available: true });
						}
					}
					throw new Error("No available remote port found");
				}
				// Suggest only (A6-14): the install runs in the worker process, so a
				// reservation held here protected nothing and only shrank the pool.
				const owner = Symbol("port suggestion");
				let allocated = await allocatePort(preferred && !persistedPortOwner.has(preferred) ? preferred : undefined, owner);
				while (persistedPortOwner.has(allocated)) {
					releasePortReservation(allocated, owner);
					allocated = await allocatePort(undefined, owner);
				}
				releasePortReservation(allocated, owner);
				return NextResponse.json({ port: allocated, available: true });
			} catch (err) {
				const msg = getErrorMessage(err, "Configuration check failed");
				throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
			}
		}

		// action=used-ports: list all currently used ports
		if (action === "used-ports") {
			const liveUsed = remote ? await getRemoteUsedPorts(remote) : await getUsedPorts();
			return NextResponse.json({ usedPorts: [...new Set([...liveUsed, ...persistedPortOwner.keys()])].sort((a, b) => a - b) });
		}

		// Default: check a specific port
		if (port === undefined) {
			throw new ValidationError(apiCopy("apiCopy.please.provide.the.port.parameter.b3868220"));
		}
		if (persistedPortOwner.has(port)) {
			return NextResponse.json({ port, available: false, usedBy: persistedPortOwner.get(port) ?? null });
		}

		const result = remote
			? {
					available: await isRemotePortAvailable(remote, port),
					usedBy: null as string | null,
				}
			: await checkPort(port);
		return NextResponse.json({ port, ...result });
	});
}
