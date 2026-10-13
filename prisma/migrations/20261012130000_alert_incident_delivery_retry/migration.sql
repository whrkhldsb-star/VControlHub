-- Delivery state of an incident's "fired" notification, separate from the
-- incident state: a channel that failed when the incident opened is retried
-- with backoff while the incident stays OPEN. Additive; existing rows start
-- with nothing pending.
ALTER TABLE "alert_incidents" ADD COLUMN "pendingNotifyChannels" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "alert_incidents" ADD COLUMN "notifyAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "alert_incidents" ADD COLUMN "nextNotifyAt" TIMESTAMP(3);
ALTER TABLE "alert_incidents" ADD COLUMN "lastNotifyError" TEXT;
