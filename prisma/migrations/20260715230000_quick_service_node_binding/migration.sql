-- Quick Services node binding: hub-host vs remote VPS instances
ALTER TABLE "quick_services" ADD COLUMN IF NOT EXISTS "instanceKey" TEXT NOT NULL DEFAULT 'hub-host';
ALTER TABLE "quick_services" ADD COLUMN IF NOT EXISTS "serverId" TEXT;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quick_services_slug_key'
  ) THEN
    ALTER TABLE "quick_services" DROP CONSTRAINT "quick_services_slug_key";
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quick_services_instanceKey_slug_key'
  ) THEN
    ALTER TABLE "quick_services" ADD CONSTRAINT "quick_services_instanceKey_slug_key" UNIQUE ("instanceKey", "slug");
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "quick_services_serverId_status_idx" ON "quick_services"("serverId", "status");
CREATE INDEX IF NOT EXISTS "quick_services_instanceKey_status_idx" ON "quick_services"("instanceKey", "status");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'quick_services_serverId_fkey'
  ) THEN
    ALTER TABLE "quick_services"
      ADD CONSTRAINT "quick_services_serverId_fkey"
      FOREIGN KEY ("serverId") REFERENCES "servers"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
