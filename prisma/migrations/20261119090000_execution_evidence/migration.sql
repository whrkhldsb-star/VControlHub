ALTER TABLE "command_targets" ADD COLUMN "executionChannel" TEXT, ADD COLUMN "fallbackReason" TEXT;
ALTER TABLE "servers" ADD COLUMN "capabilitySince" TIMESTAMP(3), ADD COLUMN "lastCommandSuccessAt" TIMESTAMP(3), ADD COLUMN "lastCommandChannel" TEXT;
ALTER TABLE "StorageNode" ADD COLUMN "lastHealthyAt" TIMESTAMP(3), ADD COLUMN "lastHealthyTransport" TEXT;

-- Retire the previous connection's observations wherever a profile is edited or transferred.
CREATE FUNCTION vch_reset_connection_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.host, NEW.port, NEW.username, NEW."managementMode", NEW."agentTokenHash", NEW."teamId", NEW."hostKeySha256", NEW."sshKeyId", NEW.password)
     IS DISTINCT FROM ROW(OLD.host, OLD.port, OLD.username, OLD."managementMode", OLD."agentTokenHash", OLD."teamId", OLD."hostKeySha256", OLD."sshKeyId", OLD.password) THEN
    NEW."capabilitySince" := clock_timestamp() AT TIME ZONE 'UTC';
    NEW."lastCommandSuccessAt" := NULL;
    NEW."lastCommandChannel" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reset_connection_evidence BEFORE UPDATE OF host, port, username, "managementMode", "agentTokenHash", "teamId", "hostKeySha256", "sshKeyId", password ON servers
FOR EACH ROW EXECUTE FUNCTION vch_reset_connection_evidence();

CREATE FUNCTION vch_reset_storage_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF ROW(NEW.driver, NEW."basePath", NEW."serverId", NEW."teamId", NEW.host, NEW.port, NEW.username, NEW."hostKeySha256", NEW."webdavConfigEncrypted")
     IS DISTINCT FROM ROW(OLD.driver, OLD."basePath", OLD."serverId", OLD."teamId", OLD.host, OLD.port, OLD.username, OLD."hostKeySha256", OLD."webdavConfigEncrypted") THEN
    NEW."lastHealthyAt" := NULL;
    NEW."lastHealthyTransport" := NULL;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER reset_storage_evidence BEFORE UPDATE ON "StorageNode" FOR EACH ROW EXECUTE FUNCTION vch_reset_storage_evidence();

CREATE FUNCTION vch_record_command_success() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE servers SET "lastCommandSuccessAt" = NEW."finishedAt", "lastCommandChannel" = NEW."executionChannel"
    WHERE id = NEW."serverId" AND ("lastCommandSuccessAt" IS NULL OR "lastCommandSuccessAt" <= NEW."finishedAt")
      AND ("capabilitySince" IS NULL OR "capabilitySince" <= NEW."startedAt")
      AND "teamId" IS NOT DISTINCT FROM (SELECT "teamId" FROM command_requests WHERE id = NEW."commandRequestId");
  RETURN NEW;
END $$;
CREATE TRIGGER record_command_success AFTER UPDATE OF status ON command_targets
FOR EACH ROW WHEN (NEW.status = 'COMPLETED' AND NEW."exitCode" = 0 AND NOT NEW."outcomeUnknown" AND NEW."executionChannel" IS NOT NULL)
EXECUTE FUNCTION vch_record_command_success();
