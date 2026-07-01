const { Client } = require("pg");
require("dotenv").config({ path: ".env.local" });

const sql = `
-- Create server_uptime_snapshots table
CREATE TABLE IF NOT EXISTS "server_uptime_snapshots" (
    "id" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "uptimePercent" DOUBLE PRECISION NOT NULL,
    "onlineMinutes" INTEGER NOT NULL,
    "offlineMinutes" INTEGER NOT NULL,
    "checkCount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "server_uptime_snapshots_pkey" PRIMARY KEY ("id")
);

-- Create unique constraint on (serverId, date)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'server_uptime_snapshots_serverId_date_key'
    ) THEN
        CREATE UNIQUE INDEX "server_uptime_snapshots_serverId_date_key" ON "server_uptime_snapshots"("serverId", "date");
    END IF;
END $$;

-- Create index on (serverId, date)
CREATE INDEX IF NOT EXISTS "server_uptime_snapshots_serverId_date_idx" ON "server_uptime_snapshots"("serverId", "date");

-- Add foreign key to servers
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'server_uptime_snapshots_serverId_fkey'
    ) THEN
        ALTER TABLE "server_uptime_snapshots"
        ADD CONSTRAINT "server_uptime_snapshots_serverId_fkey"
        FOREIGN KEY ("serverId") REFERENCES "servers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
    END IF;
END $$;
`;

(async () => {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    await client.query(sql);
    console.log("✅ Migration applied successfully");
  } catch (err) {
    console.error("❌ Migration failed:", err.message);
    process.exit(1);
  } finally {
    await client.end();
  }
})();