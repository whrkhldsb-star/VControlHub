import { Client } from "pg";
import { afterAll, beforeAll } from "vitest";

/** The platform's own advisory lock namespaces are 45057–45090 (src/lib/concurrency/advisory-lock.ts). */
const TEST_LOCK_NAMESPACE = 45999;
const WAIT_MS = 120_000;

/**
 * Some integration files run one of the platform's sweeps, which act on every row that is due, not only
 * the file's own: every due VPS backup schedule, every due scheduled task. The files share one database,
 * and CI's coverage run (`npm run test:coverage` with RUN_DATABASE_INTEGRATION_TESTS=1) runs two files at
 * a time, so one file's sweep dispatched or paused what another file was in the middle of checking.
 *
 * Called first inside a file's describe block, this holds a PostgreSQL advisory lock named after the sweep
 * from before the file's first hook to after its last one: files that name the same sweep run one after the
 * other. The lock is held by a session of its own, since a pooled query cannot promise to release it on the
 * connection that took it.
 */
export function oneFileAtATime(sweep: string) {
  let session: Client | undefined;
  beforeAll(async () => {
    const url = new URL(process.env.DATABASE_URL!);
    // Prisma-only tuning parameters are not PostgreSQL startup options.
    for (const name of ["pool_max", "pool_idle_timeout", "connection_limit"]) url.searchParams.delete(name);
    session = new Client({ connectionString: url.toString() });
    // A session lost while it holds the lock ends the lock; the file goes on without it rather than crash.
    session.on("error", () => undefined);
    await session.connect();
    await session.query(`SET lock_timeout = ${WAIT_MS}`);
    await session.query("SELECT pg_advisory_lock($1, hashtext($2))", [TEST_LOCK_NAMESPACE, sweep]);
  }, WAIT_MS + 10_000);
  // Added before the file's own hooks, so it runs after its afterAll clean-up ("stack" order). Ending the
  // session ends its lock.
  afterAll(async () => {
    await session?.end();
  });
}
