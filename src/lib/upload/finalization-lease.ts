import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { UploadOutcomeUnknownError, ConflictError } from "@/lib/errors";
import { t } from "@/lib/i18n/service-translations";
import { logError } from "@/lib/logging";

export const FINALIZATION_LEASE_MS = 120_000;
export const FINALIZATION_HEARTBEAT_MS = 15_000;
export const UPLOAD_REVIEW_MESSAGE = "Upload result is unconfirmed. Inspect the target and retained upload data before uploading again.";

/** Recover only fenced uploads. Never replay a remote write or remove its bytes. */
export async function recoverInterruptedFinalizations(): Promise<number> {
  return prisma.$executeRaw`
    UPDATE media_upload_sessions
    SET status = 'FAILED', "recoveryRequired" = true,
        "errorMessage" = ${UPLOAD_REVIEW_MESSAGE}, "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
    WHERE status = 'FINALIZING' AND "finalizationToken" IS NOT NULL
      AND "finalizationLeaseUntil" < (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
}

export type FinalizationLease = Awaited<ReturnType<typeof beginUploadFinalization>>;
export async function beginUploadFinalization(sessionId: string, userId: string) {
  const token = randomUUID();
  const claimed = await prisma.mediaUploadSession.updateMany({
    where: { id: sessionId, userId, status: { in: ["PENDING", "UPLOADING"] }, expiresAt: { gt: new Date() } },
    data: { status: "FINALIZING", finalizationToken: token, finalizationLeaseUntil: new Date(Date.now() + FINALIZATION_LEASE_MS), recoveryRequired: false },
  });
  if (claimed.count !== 1) throw new ConflictError(t("backend.storage.uploadSessionNotActive"));
  let stopped = false;
  let lost = false;
  let writing = false;
  let pending = false;
  let deadline = Date.now() + FINALIZATION_LEASE_MS;
  const fence = { id: sessionId, userId, status: "FINALIZING" as const, finalizationToken: token };
  async function assertActive() {
    if (stopped || lost || Date.now() >= deadline) { lost = true; throw new UploadOutcomeUnknownError(t("backend.storage.uploadOutcomeUnknown")); }
    const started = Date.now();
    const changed = await prisma.$executeRaw`
      UPDATE media_upload_sessions
      SET "finalizationLeaseUntil" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') + INTERVAL '120 seconds', "updatedAt" = (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
      WHERE id = ${sessionId} AND "userId" = ${userId} AND status = 'FINALIZING'
        AND "finalizationToken" = ${token} AND "finalizationLeaseUntil" > (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')`;
    if (changed !== 1 || stopped || lost || Date.now() >= started + FINALIZATION_LEASE_MS) {
      lost = true; throw new UploadOutcomeUnknownError(t("backend.storage.uploadOutcomeUnknown"));
    }
    deadline = started + FINALIZATION_LEASE_MS;
  }
  const timer = setInterval(() => {
    if (pending || stopped || lost) return;
    pending = true;
    void assertActive().catch(() => { lost = true; }).finally(() => { pending = false; });
  }, FINALIZATION_HEARTBEAT_MS);
  timer.unref?.();
  return {
    token,
    assertActive,
    async beforeWrite(metadata: Prisma.InputJsonValue) {
      await assertActive();
      const changed = await prisma.mediaUploadSession.updateMany({
        where: { ...fence, finalizationLeaseUntil: { gt: new Date() } },
        data: { recoveryMetadata: metadata },
      });
      if (changed.count !== 1) { lost = true; throw new UploadOutcomeUnknownError(t("backend.storage.uploadOutcomeUnknown")); }
      await assertActive();
      writing = true;
    },
    async fail() {
      // Once a write was attempted, even a transport error may hide success.
      // Retain recovery material and do not silently encourage a second write.
      const review = writing || lost;
      const changed = await prisma.mediaUploadSession.updateMany({
        where: fence,
        data: { status: "FAILED", recoveryRequired: review, errorMessage: review ? UPLOAD_REVIEW_MESSAGE : "Upload interrupted before target write; select the source file to retry." },
      });
      return { review, changed: changed.count === 1 };
    },
    stop() { stopped = true; clearInterval(timer); },
  };
}

export async function recordFinalizationFailure(lease: FinalizationLease) {
  try { return await lease.fail(); }
  catch (error) { logError("upload:failure-status-update-failed", error); return { review: true, changed: false }; }
}
