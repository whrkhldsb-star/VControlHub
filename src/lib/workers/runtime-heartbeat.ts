import { config } from "@/lib/config/env";
import { prisma } from "@/lib/db";
import { createLogger } from "@/lib/logging";
import { getWorkerDefinitions, type WorkerId } from "./registry";

const logger = createLogger("worker-runtime-heartbeat");
const HEARTBEAT_INTERVAL_MS = 15_000;
const RUNTIME_RETENTION_MS = 7 * 24 * 60 * 60 * 1_000;
const instanceId = `${config.app.hostname || "vcontrolhub"}:${process.pid}`;

type RuntimeHeartbeatState = {
  timer: NodeJS.Timeout | null;
  workerIds: WorkerId[];
};

const state: RuntimeHeartbeatState = { timer: null, workerIds: [] };

export async function startWorkerRuntimeHeartbeat(input: {
  started: WorkerId[];
  failed: Array<{ id: WorkerId; error: string }>;
}) {
  const definitions = getWorkerDefinitions();
  const failedById = new Map(input.failed.map((failure) => [failure.id, failure.error]));
  const startedSet = new Set(input.started);
  const now = new Date();

  await prisma.workerRuntime.deleteMany({
    where: { lastHeartbeatAt: { lt: new Date(now.getTime() - RUNTIME_RETENTION_MS) } },
  });

  await Promise.all(
    definitions.map((worker) =>
      prisma.workerRuntime.upsert({
        where: { workerId_instanceId: { workerId: worker.id, instanceId } },
        create: {
          workerId: worker.id,
          label: worker.label,
          jobType: worker.jobType,
          instanceId,
          status: startedSet.has(worker.id) ? "RUNNING" : "FAILED",
          startedAt: now,
          lastHeartbeatAt: now,
          lastError: failedById.get(worker.id) ?? null,
        },
        update: {
          label: worker.label,
          jobType: worker.jobType,
          status: startedSet.has(worker.id) ? "RUNNING" : "FAILED",
          startedAt: now,
          lastHeartbeatAt: now,
          lastError: failedById.get(worker.id) ?? null,
        },
      }),
    ),
  );

  state.workerIds = input.started;
  if (state.timer) clearInterval(state.timer);
  state.timer = setInterval(() => {
    const heartbeatAt = new Date();
    void prisma.workerRuntime.updateMany({
      where: { instanceId, workerId: { in: state.workerIds }, status: "RUNNING" },
      data: { lastHeartbeatAt: heartbeatAt },
    }).catch((error: unknown) => {
      logger.error("worker runtime heartbeat failed", error, { instanceId });
    });
  }, HEARTBEAT_INTERVAL_MS);
  state.timer.unref?.();
}

export async function stopWorkerRuntimeHeartbeat() {
  if (state.timer) clearInterval(state.timer);
  state.timer = null;
  await prisma.workerRuntime.updateMany({
    where: { instanceId, status: "RUNNING" },
    data: { status: "STOPPED", lastHeartbeatAt: new Date() },
  }).catch(() => undefined);
  state.workerIds = [];
}
