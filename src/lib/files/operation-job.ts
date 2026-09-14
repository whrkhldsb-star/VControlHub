import { apiCopy, withApiCopyLocale } from "@/lib/i18n/api-copy";
import { prisma } from "@/lib/db";
import {
  claimNextJob,
  heartbeatJob,
  completeJob,
  failJob,
  cancelJob,
} from "@/lib/job/service";
import { runWithLeaseHeartbeat } from "@/lib/job/heartbeat-runner";
import { loadApiTokenOwnerSession } from "@/lib/api-token/authorization";
import { sessionHasPermission } from "@/lib/auth/authorization";
import { executeMoveFile } from "./move-operation";
import { executeDeleteFile } from "./delete-operation";
import { copyFileEntry } from "./copy-operation";
import {
  FILE_OPERATION_JOB_TYPE,
  FileOperationUncertainError,
  fileOperationSchema,
  type FileOperationResult,
} from "./operation-schema";
import { createLogger } from "@/lib/logging";

const logger = createLogger("file-operation-worker");
const workerId = `file-operations:${process.pid}`;
const leaseMs = 120000;
let timer: ReturnType<typeof setInterval> | undefined;
let running = false;

export async function runFileOperationWorkerOnce() {
  if (running) return;
  running = true;
  try {
    const job = await claimNextJob({
      workerId,
      types: [FILE_OPERATION_JOB_TYPE],
      leaseMs,
    });
    if (!job) return;
    await withApiCopyLocale(
      (job.payload as Record<string, unknown>)?.locale === "zh" ? "zh" : "en",
      async () => {
        try {
          const input = fileOperationSchema.parse(job.payload);
          const results: FileOperationResult[] = [];
          let progress = `0/${input.fileEntryIds.length}`;
          await runWithLeaseHeartbeat({
            jobId: job.id,
            leaseMs,
            heartbeat: () =>
              heartbeatJob(job.id, workerId, { leaseMs, progress }),
            run: async (signal) => {
              for (const id of input.fileEntryIds) {
                signal.throwIfAborted();
                const latest = await prisma.job.findUnique({
                  where: { id: job.id },
                  select: { payload: true, status: true },
                });
                if (!latest || latest.status !== "RUNNING") return;
                const session = job.createdBy
                  ? await loadApiTokenOwnerSession(job.createdBy)
                  : null;
                if (
                  !session ||
                  !sessionHasPermission(
                    session,
                    input.action === "delete"
                      ? "storage:delete"
                      : "storage:write",
                  )
                )
                  throw new Error(apiCopy("apiCopy.files.op.revoked"));
                if (job.teamId) {
                  const membership = await prisma.teamMember.findUnique({
                    where: {
                      teamId_userId: {
                        teamId: job.teamId,
                        userId: session.userId,
                      },
                    },
                    select: { userId: true },
                  });
                  if (!membership)
                    throw new Error(apiCopy("apiCopy.files.op.membership"));
                }
                session.currentTeamId = job.teamId;
                if (
                  (latest.payload as Record<string, unknown>).cancelRequested
                ) {
                  await cancelJob(job.id, session);
                  return;
                }
                const names = (job.payload as Record<string, unknown>).names as
                  Record<string, string> | undefined;
                const result: FileOperationResult = {
                  id,
                  name: names?.[id],
                  state: "running",
                };
                results.push(result);
                const checkpoint = await prisma.job.updateMany({
                  where: { id: job.id, status: "RUNNING", workerId },
                  data: { result: { items: results }, progress },
                });
                if (!checkpoint.count) return;
                try {
                  if (input.action === "copy") {
                    const copied = await copyFileEntry({
                      session,
                      fileEntryId: id,
                      targetDir: input.targetDir,
                      policy: input.policy,
                      signal,
                      onProgress: async (done, total) => {
                        progress = `${results.length - 1}/${input.fileEntryIds.length} (${done}/${total})`;
                        const heartbeat = await heartbeatJob(job.id, workerId, {
                          leaseMs,
                          progress,
                        });
                        if (!heartbeat.count)
                          throw new Error(apiCopy("apiCopy.files.op.lease"));
                      },
                    });
                    result.state = copied.skipped ? "skipped" : "success";
                    result.path = copied.path;
                  } else {
                    const form = new FormData();
                    form.set("fileEntryId", id);
                    form.set("targetDir", input.targetDir);
                    const outcome =
                      input.action === "move"
                        ? await executeMoveFile(session, form, (job.payload as Record<string, unknown>).locale === "zh" ? "zh" : "en")
                        : await executeDeleteFile(session, form, (job.payload as Record<string, unknown>).locale === "zh" ? "zh" : "en");
                    if (outcome.error) throw new Error(outcome.error);
                    result.state = "success";
                  }
                } catch (error) {
                  result.state =
                    error instanceof FileOperationUncertainError
                      ? "running"
                      : "error";
                  result.error = (
                    error instanceof Error ? error.message : String(error)
                  ).slice(0, 1000);
                }
                progress = `${results.length}/${input.fileEntryIds.length}`;
                await prisma.job.updateMany({
                  where: { id: job.id, status: "RUNNING", workerId },
                  data: { result: { items: results }, progress },
                });
              }
            },
          });
          if (
            results.some(
              (item) => item.state === "error" || item.state === "running",
            )
          )
            await failJob(
              job.id,
              workerId,
              apiCopy("apiCopy.files.op.failedCount", {
                v0: results.filter(
                  (item) => item.state === "error" || item.state === "running",
                ).length,
              }),
            );
          else await completeJob(job.id, workerId, { items: results });
        } catch (error) {
          await failJob(
            job.id,
            workerId,
            error instanceof Error ? error.message : String(error),
          );
        }
      },
    );
  } catch (error) {
    logger.error("File operation worker failed", {
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    running = false;
  }
}

export async function startFileOperationWorker() {
  if (timer) return;
  void runFileOperationWorkerOnce();
  timer = setInterval(() => {
    void runFileOperationWorkerOnce();
  }, 3000);
  timer.unref?.();
}
export function stopFileOperationWorker() {
  clearInterval(timer);
  timer = undefined;
}
