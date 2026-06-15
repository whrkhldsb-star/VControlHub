/**
 * Next.js instrumentation hook.
 *
 * TR-001 T13c: this is the single entry point for starting every
 * durable-job worker. Previously the start call was split:
 *   - `src/server.ts` started all 8 workers directly.
 *   - `src/instrumentation.ts` (this file) only started the command
 *     workers, and only behind `VCONTROLHUB_START_COMMAND_WORKER_IN_NEXT=true`.
 *
 * That meant a `next start` deployment (without the custom server)
 * would silently lose every non-command worker (download.execute,
 * scheduled-task.tick, etc.). See README "New-D" note.
 *
 * `next({ dev: false })` in `src/server.ts` calls `app.prepare()`
 * which triggers this hook, so the custom server path still works.
 * `next start` and `next dev` will also trigger this hook, so any
 * future deployment style gets all workers for free.
 *
 * Test mode (VITEST=true / NODE_ENV=test) is detected inside
 * `startWorkerLifecycle()` and short-circuits before importing the
 * workers, so vitest runs don't accidentally spin up background timers.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // Load BigInt serialization patch early (preserved from prior version).
  await import("./lib/bigint-patch");

  const { startWorkerLifecycle } = await import("./lib/workers/startup");
  await startWorkerLifecycle();

  // TR-051: 启动时校验 ADMIN_INITIAL_PASSWORD (env) 与 DB hash 一致性。
  // 只读 + 只 log, 失败不抛错 (避免锁死生产)。详细结果查 npm run admin:consistency-check。
  try {
    const { verifyAdminPasswordConsistency } = await import("./lib/auth/bootstrap");
    const result = await verifyAdminPasswordConsistency();
    if (result.ok) {
      console.log(`[auth:bootstrap] admin password consistency OK (user=${result.username})`);
    } else {
      console.error(`[auth:bootstrap] admin password consistency FAILED: ${result.message}`);
    }
  } catch (err) {
    console.error(`[auth:bootstrap] admin password consistency check errored: ${err instanceof Error ? err.message : String(err)}`);
  }
}
