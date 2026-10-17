-- Komari-style node information for the status board and the server pages.
-- Expand-only: every new column is nullable or has a default, nothing is
-- rewritten, and no server becomes public.

-- Host facts on the latest-metrics row; unknown until a sample carries them.
ALTER TABLE "server_metric_latest"
  ADD COLUMN "arch" TEXT,
  ADD COLUMN "kernelVersion" TEXT,
  ADD COLUMN "osName" TEXT,
  ADD COLUMN "cpuModel" TEXT,
  ADD COLUMN "virtualization" TEXT,
  ADD COLUMN "processCount" INTEGER,
  ADD COLUMN "tcpConnections" INTEGER,
  ADD COLUMN "udpConnections" INTEGER;

-- History of load and process/socket counts; older rows stay null (a gap).
ALTER TABLE "metric_snapshots"
  ADD COLUMN "load1" DOUBLE PRECISION,
  ADD COLUMN "processCount" INTEGER,
  ADD COLUMN "tcpConnections" INTEGER,
  ADD COLUMN "udpConnections" INTEGER;

-- Rental expiry and monthly traffic allowance per server.
ALTER TABLE "servers"
  ADD COLUMN "expiresAt" TIMESTAMP(3),
  ADD COLUMN "trafficQuotaBytes" BIGINT,
  ADD COLUMN "trafficQuotaMode" TEXT NOT NULL DEFAULT 'sum';

-- Optional flag for a public node.
ALTER TABLE "public_status_nodes" ADD COLUMN "countryCode" TEXT;

-- New boards show system facts and connection counts; billing stays opt-in.
ALTER TABLE "public_status_sites"
  ALTER COLUMN "metrics" SET DEFAULT ARRAY['cpu', 'memory', 'disk', 'network', 'traffic', 'uptime', 'load', 'latency', 'availability', 'system', 'connections']::TEXT[];

-- A board whose categories were never changed from the original default gets
-- the two new default categories as well; a customised list is left alone.
UPDATE "public_status_sites"
SET "metrics" = "metrics" || ARRAY['system', 'connections']::TEXT[]
WHERE cardinality("metrics") = 9
  AND "metrics" @> ARRAY['cpu', 'memory', 'disk', 'network', 'traffic', 'uptime', 'load', 'latency', 'availability']::TEXT[];
