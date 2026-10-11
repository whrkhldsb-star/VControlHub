-- Servers the platform assigns to a customer versus servers a customer adds
-- itself. Customer accounts may edit and delete only their own servers.
CREATE TYPE "ServerOrigin" AS ENUM ('PLATFORM', 'CUSTOMER');

ALTER TABLE "servers" ADD COLUMN "origin" "ServerOrigin" NOT NULL DEFAULT 'PLATFORM';
ALTER TABLE "servers" ADD COLUMN "addedById" TEXT;
ALTER TABLE "servers" ADD CONSTRAINT "servers_addedById_fkey"
  FOREIGN KEY ("addedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "servers_addedById_idx" ON "servers"("addedById");
