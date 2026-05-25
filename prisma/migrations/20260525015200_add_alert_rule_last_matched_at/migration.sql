-- Track when an alert rule condition first became true so durationSeconds
-- can require sustained violations before notification.
ALTER TABLE "AlertRule" ADD COLUMN "lastMatchedAt" TIMESTAMP(3);
