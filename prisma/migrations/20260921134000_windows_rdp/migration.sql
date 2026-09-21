ALTER TABLE "servers" ADD COLUMN "operatingSystem" TEXT NOT NULL DEFAULT 'LINUX', ADD COLUMN "rdpDomain" TEXT, ADD COLUMN "rdpPassword" TEXT, ADD COLUMN "rdpIgnoreCertificate" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "servers" ADD CONSTRAINT "servers_operating_system_check" CHECK ("operatingSystem" IN ('LINUX', 'WINDOWS'));
ALTER TABLE "servers" ADD CONSTRAINT "servers_windows_isolation_check" CHECK ("operatingSystem" <> 'WINDOWS' OR ("password" IS NULL AND "sshKeyId" IS NULL AND "managementMode" = 'DIRECT' AND "agentTokenHash" IS NULL));
CREATE TABLE "rdp_tickets" (
 "hash" TEXT PRIMARY KEY, "serverId" TEXT NOT NULL REFERENCES "servers"("id") ON DELETE CASCADE,
 "userId" TEXT NOT NULL, "teamId" TEXT, "sessionHash" TEXT NOT NULL, "origin" TEXT NOT NULL,
 "endpointHash" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "rdp_tickets_expiresAt_idx" ON "rdp_tickets"("expiresAt");
