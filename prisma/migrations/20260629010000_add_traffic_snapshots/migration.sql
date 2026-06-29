-- Traffic history snapshots for /traffic persisted trends (24h/7d).
CREATE TABLE "traffic_snapshots" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "serverId" TEXT,
    "iface" TEXT NOT NULL,
    "rxBytes" BIGINT NOT NULL,
    "txBytes" BIGINT NOT NULL,
    "rxRateBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "txRateBps" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "sampledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "traffic_snapshots_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "traffic_snapshots_source_iface_sampledAt_idx" ON "traffic_snapshots"("source", "iface", "sampledAt");
CREATE INDEX "traffic_snapshots_serverId_iface_sampledAt_idx" ON "traffic_snapshots"("serverId", "iface", "sampledAt");

ALTER TABLE "traffic_snapshots" ADD CONSTRAINT "traffic_snapshots_serverId_fkey" FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
