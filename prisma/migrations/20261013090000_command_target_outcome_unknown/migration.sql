-- A command target whose remote outcome is unknown (an Agent or executor never
-- acknowledged cancellation, or the executor was lost) stays FAILED for the
-- request lifecycle but is flagged so automatic retries do not re-run it.
-- Additive with a default; existing rows are unflagged.
ALTER TABLE "command_targets" ADD COLUMN "outcomeUnknown" BOOLEAN NOT NULL DEFAULT false;
