// @vitest-environment node
import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { claimNextJob, enqueueJob } from "../service";

/**
 * Enqueuing writes the job's "enqueued" event without waiting for it, and the
 * event's foreign key check holds a KEY SHARE lock on the job row while it
 * inserts. The claim locked its candidate FOR UPDATE SKIP LOCKED, which
 * conflicts with KEY SHARE, so a claim right after an enqueue could skip the
 * job just enqueued: in production every tick worker (alerts, health, traffic,
 * schedules) ran one interval late about one tick in five. Real PostgreSQL only.
 */
describe.skipIf(process.env.RUN_DATABASE_INTEGRATION_TESTS !== "1")("job claim and job event locks", () => {
  const type = `claim-event-lock-${randomUUID()}`;

  afterAll(async () => {
    await prisma.job.deleteMany({ where: { type } });
    await prisma.$disconnect();
  });

  it("claims a job while one of its events is being written", async () => {
    const database = new URL(process.env.DATABASE_URL!);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname) || !/audit|test|_ci/.test(database.pathname)) {
      throw new Error("requires an isolated loopback audit/test database");
    }
    const job = await enqueueJob({ type, title: type, payload: {} });
    const writer = new Client({ connectionString: process.env.DATABASE_URL });
    await writer.connect();
    try {
      await writer.query("BEGIN");
      // An event write in flight: its foreign key check holds the job row KEY SHARE until it commits.
      await writer.query(`INSERT INTO job_events (id, "jobId", type, level, message) VALUES ($1, $2, 'progress', 'info', 'in flight')`, [randomUUID(), job.id]);
      const claimed = await claimNextJob({ workerId: "claim-event-lock", types: [type] });
      expect(claimed?.id).toBe(job.id);
      expect(claimed?.status).toBe("RUNNING");
    } finally {
      await writer.query("ROLLBACK").catch(() => undefined);
      await writer.end();
    }
  });
});
