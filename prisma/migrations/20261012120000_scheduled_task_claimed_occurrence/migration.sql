-- A scheduled-task claim used to overwrite nextRunAt with "now + 24h" and keep
-- nothing else, so a worker killed between claim and dispatch record skipped
-- the task for a day and lost the occurrence its idempotency key was built
-- from. The claimed occurrence is now kept separately; nextRunAt becomes a
-- short lease. Nullable, no backfill: existing rows have no claim in flight.
ALTER TABLE "scheduled_tasks" ADD COLUMN "claimedOccurrenceAt" TIMESTAMP(3);
