import { createLogger } from "@/lib/logging";

const logger = createLogger("job-heartbeat-runner");

export async function runWithLeaseHeartbeat<T>(input: {
	jobId: string;
	leaseMs: number;
	heartbeat: () => Promise<unknown>;
	run: () => Promise<T>;
}): Promise<T> {
	const intervalMs = Math.max(10_000, Math.min(5 * 60_000, Math.floor(input.leaseMs / 3)));
	let stopped = false;
	let heartbeatInFlight = false;
	const timer = setInterval(() => {
		if (stopped || heartbeatInFlight) return;
		heartbeatInFlight = true;
		void input.heartbeat()
			.catch((error) => logger.warn("Lease heartbeat failed", error, { jobId: input.jobId }))
			.finally(() => { heartbeatInFlight = false; });
	}, intervalMs);
	timer.unref?.();
	try {
		return await input.run();
	} finally {
		stopped = true;
		clearInterval(timer);
	}
}
