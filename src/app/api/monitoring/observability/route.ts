import { NextResponse } from "next/server";

import { withApiRoute } from "@/lib/http/api-guard";
import { createLogger } from "@/lib/logging";
import {
	getObservabilitySnapshot,
	setWsActive,
} from "@/lib/monitoring/runtime-metrics";

export const dynamic = "force-dynamic";

const logger = createLogger("api:observability");

type SshMetricsPayload = {
	websocket?: {
		active: number;
		opened: number;
		closed: number;
		errors: number;
		rejected: number;
		reconnectHints: number;
	};
	activeClients?: number;
};

async function mergeSshWsMetrics(snapshot: ReturnType<typeof getObservabilitySnapshot>) {
	try {
		const host = process.env.SSH_WS_HOST?.trim() || "127.0.0.1";
		const port = process.env.SSH_WS_PORT?.trim() || "3001";
		const res = await fetch(`http://${host}:${port}/metrics`, {
			signal: AbortSignal.timeout(1500),
			cache: "no-store",
		});
		if (!res.ok) return snapshot;
		const payload = (await res.json()) as SshMetricsPayload;
		if (payload.websocket) {
			snapshot.websocket.ssh = { ...payload.websocket };
		} else if (typeof payload.activeClients === "number") {
			setWsActive("ssh", payload.activeClients);
			snapshot.websocket.ssh.active = payload.activeClients;
		}
	} catch (error) {
		logger.debug("ssh-ws metrics scrape skipped", {
			error: error instanceof Error ? error.message : String(error),
		});
	}
	return snapshot;
}

/**
 * Combined runtime observability snapshot:
 * Web Vitals aggregates, notification delivery latency/failure rates,
 * and WebSocket connection counters (notification in-process + SSH-WS scrape).
 */
export async function GET(request: Request) {
	return withApiRoute(
		request,
		{ permission: "audit:read", errorMessage: "Failed to fetch observability metrics" },
		async () => {
			const metrics = await mergeSshWsMetrics(getObservabilitySnapshot());
			return NextResponse.json({ metrics });
		},
	);
}
