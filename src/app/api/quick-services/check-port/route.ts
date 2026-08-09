import { z } from "zod";

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { checkPort, allocatePort, getUsedPorts } from "@/lib/quick-service/service";
import { getRemoteUsedPorts, isRemotePortAvailable } from "@/lib/quick-service/docker-cli";
import { assertServerTeamAccess } from "@/lib/server/team-access";

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
	return withApiRoute(request, { permission: "docker:manage", errorStatus: 500, errorMessage: "Server error" }, async ({ session }) => {
		const { action, port, preferred, serverId } = parseSearchParams(request, checkPortQuerySchema);
		if (serverId) {
			const access = await assertServerTeamAccess(session, serverId);
			if (!access.ok) return access.response;
		}

		// action=allocate: suggest a free port
		if (action === "allocate") {
			try {
				if (serverId) {
					const start = preferred ?? 10_000;
					const usedPorts = new Set(await getRemoteUsedPorts(serverId));
					for (let offset = 0; offset < 2_000; offset += 1) {
						const candidate = ((start - 1 + offset) % 65_535) + 1;
						if (!usedPorts.has(candidate)) {
							return NextResponse.json({ port: candidate, available: true });
						}
					}
					throw new Error("No available remote port found");
				}
				const port = allocatePort(preferred);
				return NextResponse.json({ port, available: true });
			} catch (err) {
				const msg = getErrorMessage(err, "Configuration check failed");
				throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
			}
		}

		// action=used-ports: list all currently used ports
		if (action === "used-ports") {
			return NextResponse.json({ usedPorts: serverId ? await getRemoteUsedPorts(serverId) : getUsedPorts() });
		}

		// Default: check a specific port
		if (port === undefined) {
			throw new ValidationError("Please provide the port parameter");
		}

		const result = serverId
			? {
					available: await isRemotePortAvailable(serverId, port),
					usedBy: null as string | null,
				}
			: checkPort(port);
		return NextResponse.json({ port, ...result });
	});
}
