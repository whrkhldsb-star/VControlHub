ALTER TABLE "media_upload_sessions"
  ADD COLUMN "finalizationToken" TEXT,
  ADD COLUMN "finalizationLeaseUntil" TIMESTAMP(3),
  ADD COLUMN "recoveryRequired" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "recoveryMetadata" JSONB;
CREATE INDEX "media_upload_sessions_status_finalizationLeaseUntil_idx"
  ON "media_upload_sessions"("status", "finalizationLeaseUntil");
-- Legacy FINALIZING rows have no lease: leave them untouched. Never infer that
-- a still-running old-version finalizer is dead during a rolling upgrade.
