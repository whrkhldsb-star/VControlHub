-- Track when an alert rule condition first became true so durationSeconds
-- can require sustained violations before notification.
ALTER TABLE "alert_rules" ADD COLUMN "lastMatchedAt" TIMESTAMP(3);
