CREATE FUNCTION vch_cancel_disabled_agent_jobs() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE server_agent_jobs
  SET status = 'CANCELLED', stderr = 'Server disabled before claim', "exitCode" = 130,
      "completedAt" = (now() AT TIME ZONE 'UTC'), "leaseExpiresAt" = NULL
  WHERE "serverId" = NEW.id AND status = 'PENDING';
  RETURN NULL;
END $$;

CREATE TRIGGER cancel_disabled_agent_jobs AFTER UPDATE OF enabled ON servers
FOR EACH ROW WHEN (OLD.enabled AND NOT NEW.enabled)
EXECUTE FUNCTION vch_cancel_disabled_agent_jobs();
