-- A reachable server without a metrics channel (Windows without the agent)
-- is sampled online with no values instead of offline with zeros.
ALTER TABLE "metric_snapshots" ALTER COLUMN "cpuUsage" DROP NOT NULL,
ALTER COLUMN "memUsage" DROP NOT NULL,
ALTER COLUMN "diskUsage" DROP NOT NULL;
