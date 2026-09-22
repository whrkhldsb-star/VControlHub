import { spawn, type ChildProcess } from "child_process";
import { t } from "@/lib/i18n/service-translations";

/**
 * Async wrapper around the `aria2c` CLI used by the aria2 module to launch
 * the detached RPC daemon (`aria2c --conf-path=...`).
 *
 * Centralises the `detached: true / stdio: "ignore"` shape so the caller
 * (service.ts `ensureAria2Daemon`) does not have to import `child_process`
 * directly, and keeps `aria2c` binary-specific error mapping (ENOENT
 * detection, missing-binary copy) inside the adapter rather than
 * leaking that knowledge into every caller.
 */

/** Localized "aria2c not installed" copy — resolved per call, per locale. */
export function getMissingAria2BinaryMessage(locale: "zh" | "en" = "zh"): string {
  return t("backend.aria2.missingBinary", locale);
}

export function spawnAria2Detached(args: string[], command: string = "aria2c"): ChildProcess {
  return spawn(command, args, { detached: true, stdio: "ignore" });
}

export function isMissingAria2BinaryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  if (code === "ENOENT") return true;
  if (error instanceof Error && error.message.includes("spawn aria2c ENOENT")) return true;
  return false;
}
