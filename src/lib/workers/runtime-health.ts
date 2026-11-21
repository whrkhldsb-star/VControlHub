import { prisma } from "@/lib/db";
import { getWorkerDefinitions, type WorkerId } from "./registry";

export const WORKER_HEARTBEAT_STALE_MS = 60_000;

export type WorkerRuntimeHealth = {
  id: WorkerId;
  label: string;
  jobType: string;
  instances?: Array<{ instanceId: string; status: string; lastHeartbeatAt: string }>;
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
  const staleBefore = now.getTime() - WORKER_HEARTBEAT_STALE_MS;
  const rows = await prisma.workerRuntime.findMany({
    where: { workerId: { in: definitions.map(definition => definition.id) } },
    orderBy: [{ lastHeartbeatAt: "desc" }, { instanceId: "asc" }],
    select: { workerId: true, instanceId: true, status: true, startedAt: true, lastHeartbeatAt: true, lastError: true },
  });
  return definitions.map((definition) => {
    const members = rows.filter(row => row.workerId === definition.id);
    const instances = members.map(row => ({ instanceId: row.instanceId, status: row.status, lastHeartbeatAt: row.lastHeartbeatAt.toISOString() }));
    const runtime = members.find(row => row.status === "RUNNING" && row.lastHeartbeatAt.getTime() >= staleBefore) ?? members[0];
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
      instances, started: healthy,
      healthy,
      status: fresh ? runtime.status : "STALE",
      instanceId: runtime.instanceId,
      startedAt: runtime.startedAt.toISOString(),
      lastHeartbeatAt: runtime.lastHeartbeatAt.toISOString(),
      lastError: runtime.lastError,
    };
  });
}
