-- Which key a server's direct-download gateway verifies links with: 1 = the hub's shared
-- secret (installs before this migration), 2 = a key derived for that server alone.
ALTER TABLE "servers" ADD COLUMN "directGatewayKeyVersion" INTEGER NOT NULL DEFAULT 1;
