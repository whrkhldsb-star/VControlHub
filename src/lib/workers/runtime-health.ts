import { prisma } from "@/lib/db";
import { getWorkerDefinitions, type WorkerId } from "./registry";

export const WORKER_HEARTBEAT_STALE_MS = 60_000;

export type WorkerRuntimeHealth = {
  id: WorkerId;
  label: string;
  jobType: string;
  started: boolean;
  healthy: boolean;
  status: "RUNNING" | "FAILED" | "STOPPED" | "STALE" | "MISSING";
  instanceId: string | null;
  startedAt: string | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
};

export async function getWorkerRuntimeHealth(now = new Date()): Promise<WorkerRuntimeHealth[]> {
  const definitions = getWorkerDefinitions();
  const rows = await prisma.workerRuntime.findMany({
    orderBy: { lastHeartbeatAt: "desc" },
    select: {
      workerId: true,
      instanceId: true,
      status: true,
      startedAt: true,
      lastHeartbeatAt: true,
      lastError: true,
    },
  });
  const latestByWorker = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    if (!latestByWorker.has(row.workerId)) latestByWorker.set(row.workerId, row);
  }
  const staleBefore = now.getTime() - WORKER_HEARTBEAT_STALE_MS;

  return definitions.map((definition) => {
    const runtime = latestByWorker.get(definition.id);
    if (!runtime) {
      return {
        ...definition,
        started: false,
        healthy: false,
        status: "MISSING" as const,
        instanceId: null,
        startedAt: null,
        lastHeartbeatAt: null,
        lastError: null,
      };
    }

    const fresh = runtime.lastHeartbeatAt.getTime() >= staleBefore;
    const healthy = runtime.status === "RUNNING" && fresh;
    return {
      ...definition,
      started: healthy,
      healthy,
      status: fresh ? runtime.status : "STALE",
      instanceId: runtime.instanceId,
      startedAt: runtime.startedAt.toISOString(),
      lastHeartbeatAt: runtime.lastHeartbeatAt.toISOString(),
      lastError: runtime.lastError,
    };
  });
}
