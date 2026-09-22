import { existsSync } from "node:fs";
import path from "node:path";

/**
 * Resolve the tar binary used for local (hub-host) archive operations.
 *
 * Windows ships bsdtar as System32\tar.exe, but a GNU tar from Git Bash,
 * MSYS or GnuWin can shadow it in PATH. GNU tar interprets "C:\..." path
 * arguments as remote-host specs ("Cannot connect to C"), breaking every
 * local archive operation. On win32 prefer the OS-bundled System32 bsdtar
 * explicitly; other platforms keep plain PATH lookup.
 */
export function resolveLocalTarBinary(): string {
  if (process.platform !== "win32") return "tar";
  const systemRoot = process.env.SystemRoot ?? process.env.windir ?? "C:\\Windows";
  const system32Tar = path.join(systemRoot, "System32", "tar.exe");
  return existsSync(system32Tar) ? system32Tar : "tar";
}
