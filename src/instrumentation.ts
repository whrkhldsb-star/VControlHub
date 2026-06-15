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
}
