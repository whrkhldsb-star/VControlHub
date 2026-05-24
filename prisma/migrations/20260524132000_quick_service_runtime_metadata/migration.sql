-- Preserve quick-service runtime metadata needed to recreate removed containers.
-- Some existing installations may not have created quick_services yet, so keep this migration bootstrap-safe.
DO $$
BEGIN
  IF to_regclass('public.quick_services') IS NOT NULL THEN
    ALTER TABLE "quick_services" ADD COLUMN IF NOT EXISTS "internalPort" INTEGER;
    ALTER TABLE "quick_services" ADD COLUMN IF NOT EXISTS "extraPortsJson" TEXT NOT NULL DEFAULT '[]';
    ALTER TABLE "quick_services" ADD COLUMN IF NOT EXISTS "command" TEXT;
  END IF;
END $$;
