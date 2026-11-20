-- Historical keys have no verifiable bucket identity.
ALTER TABLE vps_backup_records ADD COLUMN "offsiteDestination" TEXT, ADD COLUMN "offsiteVersionId" TEXT;
