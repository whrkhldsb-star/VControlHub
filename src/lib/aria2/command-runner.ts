import { spawn, type ChildProcess } from "child_process";

/**
 * Async wrapper around the `aria2c` CLI used by the aria2 module to launch
 * the detached RPC daemon (`aria2c --conf-path=...`).
 *
 * Centralises the `detached: true / stdio: "ignore"` shape so the caller
 * (service.ts `ensureAria2Daemon`) does not have to import `child_process`
 * directly, and keeps `aria2c` binary-specific error mapping (ENOENT
 * detection, missing-binary Chinese copy) inside the adapter rather than
 * leaking that knowledge into every caller.
 */

export const MISSING_ARIA2_BINARY_MESSAGE =
  "aria2c is not installed; cannot perform magnet/BT relay download. Please install aria2 on the server";

export function spawnAria2Detached(args: string[]): ChildProcess {
  return spawn("aria2c", args, { detached: true, stdio: "ignore" });
}

export function isMissingAria2BinaryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  if (error instanceof Error && error.message.includes("spawn aria2c ENOENT")) return true;
  return false;
}
