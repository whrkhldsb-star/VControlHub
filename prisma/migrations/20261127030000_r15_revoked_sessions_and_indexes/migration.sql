-- R15 Phase 2: FK-less single-device session revocation ledger (A-02)
-- and hot-query composite indexes (D-05 / B-06).
-- All indexes use IF NOT EXISTS so operators can pre-apply CREATE INDEX CONCURRENTLY
-- on large append-only tables before the upgrade window (see docs/ci-gates.md).

CREATE TABLE "revoked_session_ids" (
    "sid" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "revoked_session_ids_pkey" PRIMARY KEY ("sid")
);

CREATE INDEX IF NOT EXISTS "revoked_session_ids_expiresAt_idx" ON "revoked_session_ids"("expiresAt");
CREATE INDEX IF NOT EXISTS "revoked_session_ids_userId_idx" ON "revoked_session_ids"("userId");

CREATE INDEX IF NOT EXISTS "audit_logs_teamId_createdAt_idx" ON "audit_logs"("teamId", "createdAt");
CREATE INDEX IF NOT EXISTS "notifications_userId_isRead_createdAt_idx" ON "notifications"("userId", "isRead", "createdAt");
CREATE INDEX IF NOT EXISTS "sync_jobs_status_updatedAt_idx" ON "sync_jobs"("status", "updatedAt");
CREATE INDEX IF NOT EXISTS "sync_logs_syncJobId_startedAt_idx" ON "sync_logs"("syncJobId", "startedAt");
CREATE INDEX IF NOT EXISTS "download_tasks_teamId_createdAt_idx" ON "download_tasks"("teamId", "createdAt");
CREATE INDEX IF NOT EXISTS "deployment_runs_teamId_createdAt_idx" ON "deployment_runs"("teamId", "createdAt");
