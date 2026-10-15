-- Snapshot the escalation window on the incident itself: escalation retry
-- copies must quote the minutes that actually triggered the escalation, not
-- the rule's (possibly edited) value at retry time. Nullable: incidents that
-- never escalated keep NULL.
ALTER TABLE "alert_incidents" ADD COLUMN "escalationMinutes" INTEGER;
