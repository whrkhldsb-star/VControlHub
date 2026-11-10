/**
 * Runs once in the Vitest main process, before any worker thread starts.
 *
 * The prebuilt bcrypt addon registers itself from a static initializer, which
 * runs once per process, and Node keeps that registration only while some
 * thread holds the addon. When the last worker that loaded it exits, the
 * registration is dropped but the shared object stays mapped (libstdc++, which
 * it brought in, has bound two symbols to it), so the initializer never runs
 * again and every later worker that imports bcrypt fails with
 * "Module did not self-register". Whether that happened depended on the order
 * the test files ran in: a run with a warm Vitest cache failed eight files
 * that passed on a cold one.
 *
 * Holding the addon here for the whole run keeps it registered.
 */
import { createRequire } from "node:module";

export default function setup(): void {
  createRequire(import.meta.url)("bcrypt");
}
