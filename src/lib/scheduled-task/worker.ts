import { prisma } from "@/lib/db";
import { createCommandRequest } from "@/lib/command/service";
import { createLogger } from "@/lib/logging";

import { recordTaskRun } from "./service";

const logger = createLogger("scheduled-task-worker");

const SCHEDULED_TASK_INTERVAL_MS = 60_000;

type ScheduledTaskWorkerState = {
  started: boolean;
  running: boolean;
  timer: NodeJS.Timeout | null;
};

type ScheduledTaskWorkerGlobal = typeof globalThis & {
  __vcontrolhubScheduledTaskWorker?: ScheduledTaskWorkerState;
};

function getWorkerState() {
  const globalState = globalThis as ScheduledTaskWorkerGlobal;
  globalState.__vcontrolhubScheduledTaskWorker ??= {
    started: false,
    running: false,
    timer: null,
  };
  return globalState.__vcontrolhubScheduledTaskWorker;
}

async function dispatchDueTask(task: {
  id: string;
  name: string;
  command: string;
  reason: string | null;
  serverIds: string[];
  createdById: string | null;
}) {
  if (task.serverIds.length === 0 || !task.createdById) {
    await recordTaskRun(task.id, "跳过：无目标服务器或无创建者");
    return;
  }

  const result = await createCommandRequest({
    title: `定时任务：${task.name}`,
    command: task.command,
    reason: task.reason ?? `由定时任务 ${task.name} 触发`,
    submissionMode: "user",
    requesterId: task.createdById,
    serverIds: task.serverIds,
  });

  await recordTaskRun(task.id, `已触发命令请求 ${result.id}`);
}

async function runScheduledTasksOnce(state: ScheduledTaskWorkerState, reason: string) {
  if (state.running) {
    logger.warn("Skipping scheduled task tick because a previous tick is still running", { reason });
    return;
  }

  state.running = true;
  try {
    const dueTasks = await prisma.scheduledTask.findMany({
      where: {
        status: "ACTIVE",
        nextRunAt: { not: null, lte: new Date() },
      },
    });

    for (const task of dueTasks) {
      try {
        await dispatchDueTask(task);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        logger.error("Scheduled task execution failed", { reason, taskId: task.id, error: message });
        try {
          await recordTaskRun(task.id, `执行失败：${message}`);
        } catch (recordError) {
          logger.error("Failed to record scheduled task run after failure", {
            reason,
            taskId: task.id,
            error: recordError instanceof Error ? recordError.message : String(recordError),
          });
        }
      }
    }
  } catch (error) {
    logger.error("Scheduled task tick failed", {
      reason,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    state.running = false;
  }
}

export async function startScheduledTaskWorker() {
  const state = getWorkerState();
  if (state.started) return state;

  state.started = true;
  const intervalMs = SCHEDULED_TASK_INTERVAL_MS;

  void runScheduledTasksOnce(state, "startup");
  state.timer = setInterval(() => {
    void runScheduledTasksOnce(state, "interval");
  }, intervalMs);
  state.timer.unref?.();

  logger.info("Scheduled task worker started", { intervalMs });
  return state;
}

export function stopScheduledTaskWorkerForTests() {
  const state = getWorkerState();
  if (state.timer) {
    clearInterval(state.timer);
  }
  state.started = false;
  state.running = false;
  state.timer = null;
}
