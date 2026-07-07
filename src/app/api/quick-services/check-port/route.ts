import { z } from "zod";

import { NextResponse } from "next/server";
import { withApiRoute } from "@/lib/http/api-guard";
import { parseSearchParams } from "@/lib/http/parse-search-params";
import { checkPort, allocatePort, getUsedPorts } from "@/lib/quick-service/service";

import { AppError, ValidationError } from "@/lib/errors";
export const dynamic = "force-dynamic";

const checkPortQuerySchema = z
  .object({
    port: z.coerce.number().int().min(1).max(65535).optional(),
    action: z.enum(["check", "allocate", "used-ports"]).optional(),
    preferred: z.coerce.number().int().min(1).max(65535).optional(),
  })
  .transform((value) => ({
    port: value.port,
    action: value.action ?? "check",
    preferred: value.preferred,
  }));

/** GET /api/quick-services/check-port?port=XXX — real-time port availability check */
export async function GET(request: Request) {
	return withApiRoute(request, { permission: "docker:manage", errorStatus: 500, errorMessage: "Server error" }, async () => {
		const { action, port, preferred } = parseSearchParams(request, checkPortQuerySchema);

		// action=allocate: suggest a free port
		if (action === "allocate") {
			try {
				const port = allocatePort(preferred);
				return NextResponse.json({ port, available: true });
			} catch (err) {
				const msg = err instanceof Error ? err.message : "Configuration check failed";
				throw new AppError({ code: "INTERNAL_ERROR", message: msg, status: 500 });
			}
		}

		// action=used-ports: list all currently used ports
		if (action === "used-ports") {
			return NextResponse.json({ usedPorts: getUsedPorts() });
		}

		// Default: check a specific port
		if (port === undefined) {
			throw new ValidationError("Please provide the port parameter");
		}

		const result = checkPort(port);
		return NextResponse.json({ port, ...result });
	});
}
