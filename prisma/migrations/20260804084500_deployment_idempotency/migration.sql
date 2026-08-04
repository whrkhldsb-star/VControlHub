ALTER TABLE "deployment_runs" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "deployment_runs_idempotencyKey_key" ON "deployment_runs"("idempotencyKey");
