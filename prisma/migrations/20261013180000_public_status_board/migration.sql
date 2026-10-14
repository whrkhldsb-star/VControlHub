-- Anonymous status board (expand-only).
-- * metric_snapshots gains the sampler interval and the Hub-to-node TCP probe
--   outcome per sample; existing rows keep NULL (they were written at the
--   former fixed 5-minute cadence, and no probe outcome was stored).
-- * server_metric_latest: one normalised row per server for cheap reads.
-- * public_status_sites / public_status_nodes: explicit opt-in publication.
--   No rows are created, so the board stays closed and every server private.

-- AlterTable
ALTER TABLE "metric_snapshots" ADD COLUMN     "intervalSeconds" INTEGER,
ADD COLUMN     "probeLatencyMs" DOUBLE PRECISION,
ADD COLUMN     "probeStatus" TEXT;

-- CreateTable
CREATE TABLE "server_metric_latest" (
    "serverId" TEXT NOT NULL,
    "checkedAt" TIMESTAMP(3) NOT NULL,
    "online" BOOLEAN NOT NULL,
    "offlineReason" TEXT,
    "metricsAt" TIMESTAMP(3),
    "metricsSource" TEXT,
    "intervalSeconds" INTEGER,
    "cpuUsage" DOUBLE PRECISION,
    "cpuCores" INTEGER,
    "load1" DOUBLE PRECISION,
    "load5" DOUBLE PRECISION,
    "load15" DOUBLE PRECISION,
    "memUsage" DOUBLE PRECISION,
    "memUsedMb" INTEGER,
    "memTotalMb" INTEGER,
    "swapUsage" DOUBLE PRECISION,
    "diskUsage" DOUBLE PRECISION,
    "diskUsedBytes" DOUBLE PRECISION,
    "diskTotalBytes" DOUBLE PRECISION,
    "uptimeSeconds" INTEGER,
    "netIface" TEXT,
    "netRxBytes" BIGINT,
    "netTxBytes" BIGINT,
    "rxRateBps" DOUBLE PRECISION,
    "txRateBps" DOUBLE PRECISION,
    "rateIntervalSeconds" DOUBLE PRECISION,
    "periodStart" TIMESTAMP(3),
    "periodSince" TIMESTAMP(3),
    "periodRxBytes" BIGINT NOT NULL DEFAULT 0,
    "periodTxBytes" BIGINT NOT NULL DEFAULT 0,
    "probeAt" TIMESTAMP(3),
    "probeOk" BOOLEAN,
    "probeLatencyMs" DOUBLE PRECISION,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "server_metric_latest_pkey" PRIMARY KEY ("serverId")
);

-- CreateTable
CREATE TABLE "public_status_sites" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "title" TEXT,
    "description" TEXT,
    "announcement" TEXT,
    "defaultView" TEXT NOT NULL DEFAULT 'cards',
    "refreshSeconds" INTEGER NOT NULL DEFAULT 15,
    "accent" TEXT NOT NULL DEFAULT 'default',
    "metrics" TEXT[] DEFAULT ARRAY['cpu', 'memory', 'disk', 'network', 'traffic', 'uptime', 'load', 'latency', 'availability']::TEXT[],
    "showPlatformStatus" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_status_sites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_status_nodes" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "publishedTeamId" TEXT,
    "displayName" TEXT NOT NULL,
    "groupName" TEXT,
    "region" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "maintenance" BOOLEAN NOT NULL DEFAULT false,
    "publishedAt" TIMESTAMP(3),
    "publishedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_status_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_status_nodes_publicId_key" ON "public_status_nodes"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "public_status_nodes_serverId_key" ON "public_status_nodes"("serverId");

-- CreateIndex
CREATE INDEX "public_status_nodes_published_sortOrder_idx" ON "public_status_nodes"("published", "sortOrder");

-- AddForeignKey
ALTER TABLE "server_metric_latest" ADD CONSTRAINT "server_metric_latest_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public_status_nodes" ADD CONSTRAINT "public_status_nodes_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

