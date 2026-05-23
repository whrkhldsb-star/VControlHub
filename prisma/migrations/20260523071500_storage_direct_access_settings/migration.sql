-- Add storage-node access routing settings.
CREATE TYPE "StorageAccessMode" AS ENUM ('PROXY', 'DIRECT', 'AUTO');

ALTER TABLE "StorageNode"
  ADD COLUMN "directAccessMode" "StorageAccessMode" NOT NULL DEFAULT 'PROXY',
  ADD COLUMN "publicBaseUrl" TEXT,
  ADD COLUMN "directAccessExpiresSeconds" INTEGER NOT NULL DEFAULT 300;
